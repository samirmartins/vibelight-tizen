'use strict';
// Bounded deterministic fuzzing of the real RTSP and H.264 SPS parsers with
// ASan/UBSan/LSan (build-tools/protocol-fuzz.cpp). The core runner uses the
// short default; the local stress coordinator reuses this same test with more
// cases through the environment:
//   ML_FUZZ_CASES   mutated cases per parser (default 400, 1..100000)
//   ML_STRESS_SEED  deterministic mutation seed (default 12345)
//   ML_FUZZ_TARGETS comma-separated subset of rtsp,h264 (default both)
//   ML_FUZZ_REPLAY  replay one saved case (requires a single target)
//   ML_FUZZ_CASE_DIR keep <target>.case.bin, the last case run, for replay
// On ARM the per-case leak scan of GCC 12's static ASan runtime costs seconds,
// so the default run is skipped there with an explicit notice; x86 and CI run
// it. Setting ML_FUZZ_CASES or ML_FUZZ_REPLAY runs it on ARM as well.
const assert = require('assert'), cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.resolve(__dirname, '..');
if (/^(aarch64|arm)/.test(os.machine()) && process.env.ML_FUZZ_CASES === undefined && !process.env.ML_FUZZ_REPLAY) {
  console.log('protocol_fuzz_test: SKIPPED on ARM (' + os.machine() + '); runs on x86 and in CI, or here with ML_FUZZ_CASES=<n>');
  return;
}
const bounded = (name, fallback, min, max) => {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  assert(Number.isInteger(value) && value >= min && value <= max, name + ' must be an integer in ' + min + '..' + max);
  return value;
};
const cases = bounded('ML_FUZZ_CASES', 400, 1, 100000);
const seed = bounded('ML_STRESS_SEED', 12345, 0, 0xffffffff);
const targets = (process.env.ML_FUZZ_TARGETS || 'rtsp,h264').split(',');
assert(targets.length > 0 && targets.every(t => t === 'rtsp' || t === 'h264') && new Set(targets).size === targets.length,
  'ML_FUZZ_TARGETS accepts rtsp and/or h264');
const replay = process.env.ML_FUZZ_REPLAY;
if (replay) {
  assert(targets.length === 1, 'ML_FUZZ_REPLAY requires exactly one target');
  assert(fs.statSync(replay).size <= 4096, 'replay cases are at most 4096 bytes');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protocol-fuzz-'));
const run = (command, args, options = {}) => cp.execFileSync(command, args, {cwd: root, stdio: 'pipe', ...options});
try {
  // The parsers log through emscripten_log; a no-op header keeps them native.
  const include = path.join(dir, 'include');
  fs.mkdirSync(include);
  fs.writeFileSync(path.join(include, 'emscripten.h'), '#define EM_LOG_CONSOLE 0\n#define emscripten_log(...) ((void)0)\n');
  const flags = ['-O1', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer'];
  const objects = ['moonlight-common-c/src/RtspParser.c', ...['h264_nal', 'h264_sei', 'h264_stream'].map(n => 'h264bitstream/' + n + '.c')]
    .map((source, index) => {
      const object = path.join(dir, 'parser-' + index + '.o');
      run('gcc', ['-std=c99', '-D_POSIX_C_SOURCE=200809L', ...flags, '-I' + include, '-Imoonlight-common-c/src',
        '-Ih264bitstream', '-c', source, '-o', object]);
      return object;
    });
  const binary = path.join(dir, 'parser-fuzz');
  run('g++', ['-std=c++17', ...flags, '-Iwasm', '-Ih264bitstream', '-Imoonlight-common-c/src',
    'build-tools/protocol-fuzz.cpp', ...objects, '-lm', '-o', binary]);

  const seedFor = target => {
    const file = path.join(dir, target + '-seed.bin');
    if (replay) fs.copyFileSync(replay, file);
    else if (target === 'rtsp') fs.writeFileSync(file, 'RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: 0\r\n\r\n');
    else {
      // A real SPS NAL from a one-frame libx264 stream.
      const video = path.join(dir, 'seed.h264');
      run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=16x16:rate=1', '-frames:v', '1',
        '-c:v', 'libx264', '-x264-params', 'bframes=0', '-f', 'h264', video]);
      const data = fs.readFileSync(video), starts = [];
      for (let i = 0; i + 3 < data.length;) {
        const prefix = data.readUInt32BE(i) === 1 ? 4 : (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 ? 3 : 0);
        if (prefix) { starts.push([i, prefix]); i += prefix; } else i++;
      }
      const index = starts.findIndex(([at, prefix]) => (data[at + prefix] & 31) === 7);
      assert(index >= 0, 'SPS seed generated');
      fs.writeFileSync(file, data.subarray(starts[index][0], index + 1 < starts.length ? starts[index + 1][0] : data.length));
    }
    return file;
  };

  const caseDir = process.env.ML_FUZZ_CASE_DIR || dir;
  const env = {...process.env, ASAN_OPTIONS: 'detect_leaks=1', UBSAN_OPTIONS: 'halt_on_error=1'};
  for (const target of targets) {
    const current = path.join(caseDir, target + '.case.bin');
    const result = cp.spawnSync(binary, [target, String(seed), String(cases), seedFor(target), current,
      replay ? 'replay' : 'mutate'], {cwd: root, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, timeout: 600000});
    if (result.status !== 0) {
      process.stderr.write(result.stderr.slice(-8000));
      throw Error(target + ' parser failed at ' + (result.stdout.trim().split('\n').pop() || 'start') +
        (process.env.ML_FUZZ_CASE_DIR ? '; case kept in ' + current : ''));
    }
    const executed = result.stdout.split('\n').filter(line => line.startsWith('case=')).length;
    assert.strictEqual(executed, replay ? 1 : cases, target + ' executed every case');
  }
  console.log('protocol_fuzz_test: ' + targets.join('+') + ' parsers, ' + (replay ? 'replay' : cases + ' cases each, seed ' + seed) +
    ', ASan/UBSan/LSan clean');
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}

'use strict';
// Integration uses production RTP/queue code, not the exploratory pacing model.
const fs = require('fs'), os = require('os'), path = require('path');
const cp = require('child_process'), assert = require('assert'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-pacing-'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const run = (command, args, env = {}) => cp.execFileSync(command, args, {
  cwd: root, encoding: 'utf8', timeout: 60000, env: {...process.env, ...env}, maxBuffer: 4 * 1024 * 1024
});
try {
  fs.writeFileSync(path.join(temporary, 'emscripten.h'), '#define EM_LOG_CONSOLE 0\n#define emscripten_log(...) ((void)0)\n');
  fs.writeFileSync(path.join(temporary, 'control_status.inc'), `static unsigned intervalGoodFrameCount,intervalTotalFrameCount,intervalStartTimeMs,firstFrameTimeMs,lastSeenFrame,lastGoodFrame,lastIntervalLossPercentage,lastConnectionStatusUpdate;
void connectionSawFrame(uint32_t n){lastSeenFrame=n;}void connectionReceivedCompleteFrame(uint32_t n){lastGoodFrame=n;}\n`);
  const sanitizer = process.env.ML_PACING_SANITIZER || 'address,undefined';
  assert(['address,undefined', 'thread'].includes(sanitizer));
  const flags = ['-O1', '-g', '-fsanitize=' + sanitizer, '-fno-omit-frame-pointer', '-fno-pie',
    '-ffunction-sections', '-fdata-sections', '-DLC_DEBUG', '-DRECOVERY_FIXED=1',
    '-DDEPACKETIZER_PATH=' + JSON.stringify(path.join(root, 'moonlight-common-c/src/VideoDepacketizer.c')),
    '-I' + temporary, '-Iwasm', '-Imoonlight-common-c/src',
    '-Imoonlight-common-c/enet/include', '-Imoonlight-common-c/reedsolomon'];
  const objects = [];
  for (const source of ['wasm/frame_pacing_fixture.c', 'moonlight-common-c/src/Platform.c',
    'moonlight-common-c/src/RtpVideoQueue.c', 'moonlight-common-c/src/ByteBuffer.c',
    'moonlight-common-c/src/LinkedBlockingQueue.c', 'moonlight-common-c/reedsolomon/rs.c']) {
    const object = path.join(temporary, path.basename(source) + '.o'); objects.push(object);
    run('gcc', ['-std=c11', ...flags, ...(source.endsWith('/Platform.c') ? ['-DPltGetMillis=UnusedPlatformClock'] : []),
      '-c', source, '-o', object]);
  }
  const binary = path.join(temporary, 'test');
  run('g++', ['-std=c++17', ...flags, 'wasm/frame_pacing_test.cpp', ...objects, '-no-pie',
    '-Wl,--gc-sections', '-pthread', '-o', binary]);
  process.stdout.write(run(binary, [], {ASAN_OPTIONS: 'detect_leaks=1:abort_on_error=1', UBSAN_OPTIONS: 'halt_on_error=1'}));

  // Negative control: a rejected keyframe must never be acknowledged. Mutate
  // only a generated copy and prove the native recovery assertions reject it.
  if (sanitizer === 'address,undefined') {
    const original = read('moonlight-common-c/src/VideoDepacketizer.c');
    const mutated = original.replace('else if (drStatus == DR_OK && qdu->decodeUnit.frameType == FRAME_TYPE_IDR) {',
      'if (qdu->decodeUnit.frameType == FRAME_TYPE_IDR) {');
    assert.notStrictEqual(mutated, original);
    const source = path.join(temporary, 'rejected-idr.c'); fs.writeFileSync(source, mutated);
    const negativeFlags = flags.map(flag => flag.startsWith('-DDEPACKETIZER_PATH=')
      ? '-DDEPACKETIZER_PATH=' + JSON.stringify(source) : flag);
    const object = path.join(temporary, 'negative.o');
    run('gcc', ['-std=c11', ...negativeFlags, '-c', 'wasm/frame_pacing_fixture.c', '-o', object]);
    const negativeBinary = path.join(temporary, 'negative');
    run('g++', ['-std=c++17', ...negativeFlags, 'wasm/frame_pacing_test.cpp', object,
      ...objects.slice(1), '-no-pie', '-Wl,--gc-sections', '-pthread', '-o', negativeBinary]);
    const negative = cp.spawnSync(negativeBinary, [], {cwd: root, encoding: 'utf8', timeout: 10000,
      env: {...process.env, ASAN_OPTIONS: 'detect_leaks=0:abort_on_error=1'}});
    assert(!negative.error && negative.status !== 0 && negative.stderr.includes('o.Read().recovering'),
      'negative IDR acknowledgement must fail the actual native test');
  }

  const index = read('wasm/platform/index.js');
  const branchStart = index.indexOf("  getData('framePacingExperimental', function(previousValue) {");
  const branchEnd = index.indexOf('\n  });', branchStart) + '\n  });'.length;
  assert(branchStart > 0 && branchEnd > branchStart);
  for (const [saved, expected] of [[undefined, true], [null, true], [false, false], [true, true], [1, false], ['true', false]]) {
    let state;
    vm.runInNewContext(index.slice(branchStart, branchEnd), {
      getData(key, callback) { assert.strictEqual(key, 'framePacingExperimental'); callback({framePacingExperimental: saved}); },
      document: {querySelector(selector) {
        assert.strictEqual(selector, '#framePacingBtn');
        return {MaterialSwitch: {on() { state = true; }, off() { state = false; }}};
      }}
    });
    assert.strictEqual(state, expected, 'new preferences default ON; explicit choices and invalid-value handling preserved');
  }
  const resetStart = index.indexOf('function restoreDefaultsSettingsValues(');
  const resetEnd = index.indexOf('\nfunction ', resetStart + 1);
  const reset = index.slice(resetStart, resetEnd);
  assert(reset.includes("document.querySelector('#framePacingBtn').MaterialSwitch.on();"));
  assert(reset.includes("storeData('framePacingExperimental', true, null);"));
  const html = read('wasm/index.html');
  assert(html.includes('<label>Frame pacing</label>'));
  assert(!html.includes('Frame pacing (experimental)'));
  assert.strictEqual((index.match(/const framePacing = /g) || []).length, 1);
  assert.strictEqual((index.match(/framePacing, optimizeGames, rumbleFeedback, mouseEmulation,/g) || []).length, 2);
  assert(read('wasm/platform/navigation.js').includes("'gameModeBtn',\n      'framePacingBtn'"));
  const video = read('wasm/wasmplayer.cpp');
  assert(video.includes('template<bool CollectStats, bool Paced>'));
  assert(video.includes('if constexpr (Paced)'));
  const wrapper = video.slice(video.indexOf('int MoonlightInstance::VidDecSubmitDecodeUnit('),
    video.indexOf('int MoonlightInstance::VidDecSubmitPacedDecodeUnit('));
  assert(!/Pacer|Paced|Wait\(/.test(wrapper), 'OFF submit never queries the pacer');
  const main = read('wasm/main.cpp');
  assert(main.includes('m_PacedDrCallbacks.capabilities &= ~CAPABILITY_DIRECT_SUBMIT;'));
  assert(!main.includes('capabilities |= CAPABILITY_PULL_RENDERER'));
  const scope = require('./frame-pacing-scope.cjs');
  for (const file of scope.files) {
    const source = read(file);
    const expected = scope.added.includes(file) ? '' : run('git', ['show', 'v3.4.11:' + file]);
    assert.strictEqual(scope.normalize(file, source), expected, 'exact approved integration: ' + file);
    assert.notStrictEqual(scope.normalize(file, source + '\n// unexpected neighboring change\n'), expected,
      'unknown changes remain visible: ' + file);
  }
  console.log('frame_pacing_test: integration contracts, ON defaults, saved OFF choice, shared Play/Resume argument and menu navigation PASS');
} finally { fs.rmSync(temporary, {recursive: true, force: true}); }

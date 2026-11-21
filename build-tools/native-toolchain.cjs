'use strict';
// Chooses the native compiler used by the sanitized test fixtures.
// x86 and most ARM kernels: the default gcc/g++ is used unchanged.
// ARM kernels with a 39-bit virtual address space (for example Raspberry Pi)
// cannot run the AddressSanitizer runtime shipped with newer GCC releases;
// GCC 12 linked with its static ASan runtime works there, so it is the fallback.
// Development tooling only; never packaged in the widget.
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');

const CANDIDATES = Object.freeze([
  Object.freeze({cc: 'gcc', cxx: 'g++', extra: Object.freeze([])}),
  Object.freeze({cc: 'gcc-12', cxx: 'g++-12', extra: Object.freeze(['-static-libasan'])}),
]);

const PROBE_OK = '#include <thread>\n#include <vector>\n' +
  'int main(){std::vector<int> v(4);std::thread t([&]{v[1]=2;});t.join();' +
  'int *p=new int[2];p[0]=v[1];int r=p[0];delete[] p;return r-2;}\n';
const PROBE_OVERFLOW = 'int main(){int *p=new int[2];int r=p[2];delete[] p;return r;}\n';
const PROBE_C = '#include <stdlib.h>\nint main(void){char *p=malloc(4);p[0]=0;int r=p[0];free(p);return r;}\n';

// Healthy code must run cleanly and an out-of-bounds read must be reported,
// otherwise the candidate does not provide working AddressSanitizer checks.
function probe(candidate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asan-probe-'));
  const flags = ['-fsanitize=address,undefined', '-fno-omit-frame-pointer', ...candidate.extra];
  const env = {...process.env, ASAN_OPTIONS: 'detect_leaks=1', UBSAN_OPTIONS: 'halt_on_error=1'};
  const quiet = {stdio: 'ignore', timeout: 60000, env};
  try {
    const build = (compiler, name, source, extra) => {
      fs.writeFileSync(path.join(dir, name), source);
      cp.execFileSync(compiler, [...extra, ...flags, path.join(dir, name), '-o', path.join(dir, name + '.bin')], quiet);
      return path.join(dir, name + '.bin');
    };
    cp.execFileSync(build(candidate.cxx, 'ok.cpp', PROBE_OK, ['-std=c++17', '-pthread']), [], quiet);
    cp.execFileSync(build(candidate.cc, 'ok.c', PROBE_C, ['-std=c99']), [], quiet);
    const overflow = cp.spawnSync(build(candidate.cxx, 'overflow.cpp', PROBE_OVERFLOW, []), [], {encoding: 'utf8', timeout: 60000, env});
    return overflow.status !== 0 && /AddressSanitizer: heap-buffer-overflow/.test(overflow.stderr);
  } catch (error) {
    return false;
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

function select(check = probe) {
  for (const candidate of CANDIDATES) if (check(candidate)) return candidate;
  throw Error('No compiler with working AddressSanitizer. On ARM kernels with a 39-bit address space ' +
    '(for example Raspberry Pi) install GCC 12: sudo apt install gcc-12 g++-12');
}

// Writes gcc/g++ wrappers for a fallback compiler; returns the directory to put
// first in PATH, or null when the default compiler is used unchanged.
function materialize(dir, candidate) {
  if (candidate.extra.length === 0 && candidate.cc === 'gcc' && candidate.cxx === 'g++') return null;
  fs.mkdirSync(dir, {recursive: true});
  const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
  const extra = candidate.extra.map(quote).join(' ');
  for (const [name, real] of [['gcc', candidate.cc], ['g++', candidate.cxx]]) {
    const script = '#!/bin/sh\n' +
      'case " $* " in *" -fsanitize="*address*) exec ' + quote(real) + ' "$@" ' + extra + ' ;; esac\n' +
      'exec ' + quote(real) + ' "$@"\n';
    fs.writeFileSync(path.join(dir, name), script, {mode: 0o755});
  }
  return dir;
}

// Time limits in run-tests.sh are calibrated on x86; ARM boards such as the
// Raspberry Pi need about four times longer for the ffmpeg/ASan fixtures.
function timeoutScale(machine, override) {
  if (override !== undefined && override !== '') {
    if (!/^[1-9][0-9]?$|^100$/.test(override)) throw Error('ML_TEST_TIMEOUT_SCALE must be an integer from 1 to 100');
    return Number(override);
  }
  return /^(aarch64|arm)/.test(machine) ? 4 : 1;
}

module.exports = {CANDIDATES, probe, select, materialize, timeoutScale};

if (require.main === module && process.argv[2] === '--timeout-scale') {
  try {
    process.stdout.write(String(timeoutScale(require('os').machine(), process.env.ML_TEST_TIMEOUT_SCALE)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (require.main === module) {
  try {
    const candidate = select();
    const dir = process.argv[2] ? materialize(process.argv[2], candidate) : null;
    if (dir) console.error('Using ' + candidate.cxx + ' with ' + candidate.extra.join(' ') +
      ': the default compiler has no working AddressSanitizer on this platform.');
    if (dir) process.stdout.write(dir);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

'use strict';
// Sanitizer toolchain selection used by build-tools/run-tests.sh on x86 and ARM.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const toolchain = require('../build-tools/native-toolchain.cjs');

// A working default compiler is used as is: no wrapper, no extra flags.
const calls = [];
const native = toolchain.select(candidate => { calls.push(candidate.cxx); return true; });
assert.deepStrictEqual(native, toolchain.CANDIDATES[0]);
assert.deepStrictEqual(native.extra, []);
assert.deepStrictEqual(calls, ['g++'], 'later candidates are not probed once the default works');

// Default AddressSanitizer unusable (ARM 39-bit VA): first working fallback wins.
const arm = toolchain.select(candidate => candidate.cxx === 'g++-12');
assert.strictEqual(arm.cc, 'gcc-12');
assert.deepStrictEqual(arm.extra, ['-static-libasan']);

// Nothing works: fail with an actionable message, never silently drop ASan.
assert.throws(() => toolchain.select(() => false), error =>
  /AddressSanitizer/.test(error.message) && /apt install gcc-12 g\+\+-12/.test(error.message));

// Wrappers delegate to the selected compiler and add the extra runtime flag
// only when AddressSanitizer is requested.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-toolchain-'));
try {
  const fake = path.join(dir, 'fake-compiler');
  fs.writeFileSync(fake, '#!/bin/sh\nprintf "%s|" "$@"\n', {mode: 0o755});
  const bin = path.join(dir, 'bin');
  toolchain.materialize(bin, {cc: fake, cxx: fake, extra: ['-static-libasan']});
  const run = (name, args) => cp.execFileSync(path.join(bin, name), args, {encoding: 'utf8'});
  assert.strictEqual(run('g++', ['-O1', '-fsanitize=address,undefined', 'a.cpp']),
    '-O1|-fsanitize=address,undefined|a.cpp|-static-libasan|');
  assert.strictEqual(run('gcc', ['-fsanitize=thread', 'a.c']), '-fsanitize=thread|a.c|');
  assert.strictEqual(run('gcc', ['-std=c99', 'a.c', '-o', 'a out']), '-std=c99|a.c|-o|a out|');
  // The default compiler never gets a wrapper.
  const untouched = path.join(dir, 'untouched');
  assert.strictEqual(toolchain.materialize(untouched, toolchain.CANDIDATES[0]), null);
  assert(!fs.existsSync(untouched));
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}
// Per-test time limits: unchanged on x86, four times longer on ARM, override wins.
assert.strictEqual(toolchain.timeoutScale('x86_64', undefined), 1);
assert.strictEqual(toolchain.timeoutScale('aarch64', undefined), 4);
assert.strictEqual(toolchain.timeoutScale('armv7l', ''), 4);
assert.strictEqual(toolchain.timeoutScale('x86_64', '2'), 2);
assert.strictEqual(toolchain.timeoutScale('aarch64', '1'), 1);
for (const invalid of ['0', '-1', '1.5', 'fast', '101']) {
  assert.throws(() => toolchain.timeoutScale('x86_64', invalid), /ML_TEST_TIMEOUT_SCALE/);
}
console.log('native_toolchain_test: default kept, ARM fallback with static ASan runtime, actionable failure, exact wrappers and ARM time limits OK');

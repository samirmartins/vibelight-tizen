'use strict';
const cp = require('child_process'), assert = require('assert');
function run(code, timeout = 3000) {
  return cp.spawnSync(process.execPath, ['--unhandled-rejections=strict', '--require', './build-tools/test-process.cjs', '-e', code],
    {encoding: 'utf8', timeout, env: {...process.env, ML_TEST_NAME: 'fixture'}});
}
assert.strictEqual(run("console.log('fixture: complete')").status, 0);
assert.notStrictEqual(run("(async()=>{await new Promise(()=>{});console.log('fixture: complete')})()").status, 0);
assert.notStrictEqual(run("process.exit(0)").status, 0);
assert.notStrictEqual(run("Promise.reject(Error('fixture failure'))").status, 0);
const stuck = run('setInterval(()=>{},10)', 100);
assert(stuck.error && stuck.error.code === 'ETIMEDOUT');
// The runner pre-checks exactly the history references the tests compare with.
const fs = require('fs');
const runner = fs.readFileSync('build-tools/run-tests.sh', 'utf8').match(/for reference in ([^;]+); do/);
assert(runner, 'history reference list in run-tests.sh');
const used = new Set();
for (const file of fs.readdirSync('wasm').filter(name => name.endsWith('_test.js'))) {
  const text = fs.readFileSync('wasm/' + file, 'utf8');
  for (const match of text.matchAll(/'(v[0-9]+\.[0-9]+\.[0-9]+|[0-9a-f]{7,40}):/g)) used.add(match[1]);
  for (const match of text.matchAll(/(?:BASE|reference) ?= ?'(v[0-9.]+|[0-9a-f]{7,40})'/g)) used.add(match[1]);
}
assert.deepStrictEqual(runner[1].trim().split(/\s+/).sort(), [...used].sort(), 'run-tests.sh history references match the tests');
console.log('test_runner_test: completion, unfinished promises, early exit, rejection, timeout and history reference list OK');

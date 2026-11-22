'use strict';
// The page loads the 120 FPS modules and listens for the display measurement at start-up, without
// being able to stop the rest of the start-up when something is missing.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('wasm/index.html', 'utf8'), index = fs.readFileSync('wasm/platform/index.js', 'utf8');
for (const name of ['high-refresh', 'high-refresh-menu']) {
  const tag = `<script type="text/javascript" src="platform/${name}.js"></script>`;
  assert.strictEqual(html.split(tag).length - 1, 1, `index.html loads ${name} once`);
  assert(fs.existsSync(`wasm/platform/${name}.js`));
}
const start = index.indexOf('function onWindowLoad()');
assert(start > 0);
const body = index.slice(start, index.indexOf('\n}\n', start) + 3);
function run(extra = {}) {
  const calls = [];
  const context = vm.createContext(Object.assign({console: {log() {}}, initSamsungKeys() { calls.push('keys'); }, initSpecialKeys() {}, loadSystemInfo() {},
    loadUserData() { calls.push('user'); }, startDisplayRefreshEstimator() { calls.push('estimate'); }, applyHighRefresh() {},
    onDisplayRefreshMeasured(listener) { calls.push(['listen', listener]); }}, extra));
  vm.runInContext(body + '\nonWindowLoad();', context);
  return {calls, context};
}
{
  const {calls, context} = run();
  const listen = calls.find(call => Array.isArray(call));
  assert(listen, 'the app listens for the measurement');
  assert.strictEqual(listen[1], context.applyHighRefresh);
  assert(calls.indexOf('estimate') < calls.indexOf(listen), 'registered after the estimator starts');
}
// Without display.js the rest of the start-up still runs.
{
  const {calls} = run({onDisplayRefreshMeasured: undefined});
  assert(calls.includes('keys') && calls.includes('user') && calls.includes('estimate'));
}
console.log('high_refresh_wiring_test: modules loaded once and the display measurement is listened to at start-up PASS');

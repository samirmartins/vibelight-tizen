'use strict';
// Experimental 120 FPS: offered only on a panel measured near 120 Hz, never forced on any other,
// and an interrupted 120 FPS start brings the user back to 60 FPS next time.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const context = vm.createContext({Number, String, Math});
vm.runInContext(fs.readFileSync('wasm/platform/high-refresh.js', 'utf8'), context);
const api = context.HighRefresh;

// The panel decides: only a measured rate close to 120 Hz makes the option available.
for (const [x100, expected] of [[12000, true], [11988, true], [11500, true], [14400, true], [24000, true], [11499, false], [10000, false], [6000, false], [5994, false],
  [0, false], [-1, false], [24001, false], [NaN, false], [Infinity, false], [undefined, false], [null, false], ['12000', false]]) {
  assert.strictEqual(api.supported(x100), expected, 'supported(' + x100 + ')');
}

// What a stored or chosen rate means on this panel: 120 only where it is supported, everything else unchanged.
for (const rate of ['30', '60', 30, 60, '90', '144']) assert.strictEqual(api.effective(rate, 6000), String(rate), 'unchanged: ' + rate);
assert.strictEqual(api.effective('120', 12000), '120');
assert.strictEqual(api.effective(120, 12000), '120');
assert.strictEqual(api.effective('120', 6000), '60', 'a 60 Hz panel never gets 120');
assert.strictEqual(api.effective('120', 0), '60', 'an unmeasured panel never gets 120');
assert.strictEqual(api.effective('120', undefined), '60');
assert.strictEqual(api.RATE, '120');

// The interrupted-start guard: armed before a 120 FPS start, cleared when connected.
function storage(options = {}) {
  const map = new Map();
  return {map,
    getItem(key) { if (options.failRead) throw new Error('denied'); return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { if (options.failWrite) throw new Error('full'); map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }};
}
{
  const s = storage();
  assert.strictEqual(api.interrupted(s), false, 'nothing armed at first');
  api.arm(s);
  assert.strictEqual(api.interrupted(s), true, 'the start did not finish');
  api.disarm(s);
  assert.strictEqual(api.interrupted(s), false, 'connected: nothing to recover from');
  api.disarm(s);   // harmless twice
  assert.strictEqual(s.map.size, 0, 'no leftovers');
  // Anything but the exact marker is not a pending start.
  s.map.set('vibelight.high-refresh.pending', 'x');
  assert.strictEqual(api.interrupted(s), false);
}
// Storage failures never throw and never claim an interruption.
for (const options of [{failRead: true}, {failWrite: true}]) {
  const s = storage(options);
  assert.doesNotThrow(() => { api.arm(s); api.interrupted(s); api.disarm(s); });
  assert.strictEqual(api.interrupted(s), false);
}
for (const bad of [undefined, null, {}, 'x']) {
  assert.doesNotThrow(() => { api.arm(bad); api.disarm(bad); });
  assert.strictEqual(api.interrupted(bad), false);
}

// At start-up: an interrupted 120 FPS start puts 60 back once; nothing else is touched.
{
  const s = storage();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.recover(s, '120'))), {rate: '120', recovered: false});
  api.arm(s);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.recover(s, '120'))), {rate: '60', recovered: true});
  assert.strictEqual(api.interrupted(s), false, 'the guard is cleared once handled');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.recover(s, '120'))), {rate: '120', recovered: false}, 'only once');
  api.arm(s);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.recover(s, '60'))), {rate: '60', recovered: false}, 'a 60 FPS setting needs nothing');
  assert.strictEqual(api.interrupted(s), false, 'but the stale guard is cleared');
  api.arm(s);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.recover(s, 120))), {rate: '60', recovered: true}, 'numbers too');
}
console.log('high_refresh_test: 120 only on a measured ~120 Hz panel, interrupted starts return to 60 once, storage failures contained PASS');

'use strict';
// Listeners learn the measured display refresh as soon as it is known, including those that
// register afterwards, and a failing listener never breaks the measurement.
const assert = require('assert'), fs = require('fs'), vm = require('vm');

function load() {
  let callback = null;
  const context = {console: {log() {}}, Date, Math, isFinite, window: null};
  context.window = context;
  context.requestAnimationFrame = cb => { callback = cb; return 1; };
  context.cancelAnimationFrame = () => { callback = null; };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('wasm/platform/display.js', 'utf8'), context);
  const run = hz => {
    context.startDisplayRefreshEstimator();
    let t = 100;
    for (let i = 0; i < 245 && callback; i++) { const current = callback; t += 1000 / hz; current(t); }
  };
  return {context, run};
}

// A listener registered before the measurement hears the value once it is known.
{
  const {context, run} = load(), heard = [];
  context.onDisplayRefreshMeasured(x100 => heard.push(x100));
  assert.deepStrictEqual(heard, [], 'nothing before the measurement');
  run(120);
  assert.deepStrictEqual(heard, [12000]);
}
// A listener registered later hears the known value at once.
{
  const {context, run} = load(), heard = [];
  run(60);
  context.onDisplayRefreshMeasured(x100 => heard.push(x100));
  assert.deepStrictEqual(heard, [6000]);
}
// Each measurement is reported (a later one can refine an earlier one), to every listener.
{
  const {context, run} = load(), a = [], b = [];
  context.onDisplayRefreshMeasured(x => a.push(x)); context.onDisplayRefreshMeasured(x => b.push(x));
  run(59.94);
  assert.deepStrictEqual(a, [5994]); assert.deepStrictEqual(b, [5994]);
}
// A throwing listener, or a non-function, does not stop the others or the measurement.
{
  const {context, run} = load(), heard = [];
  context.onDisplayRefreshMeasured(() => { throw new Error('listener'); });
  context.onDisplayRefreshMeasured('not a function');
  context.onDisplayRefreshMeasured(undefined);
  context.onDisplayRefreshMeasured(x => heard.push(x));
  assert.doesNotThrow(() => run(120));
  assert.deepStrictEqual(heard, [12000]);
  assert.strictEqual(context.getDisplayRefreshRateX100(60), 12000);
}
// An unreliable measurement (mixed cadence) notifies nobody.
{
  const {context} = load(), heard = [];
  let cb = null;
  context.requestAnimationFrame = fn => { cb = fn; return 1; };
  context.onDisplayRefreshMeasured(x => heard.push(x));
  context.startDisplayRefreshEstimator();
  let t = 100;
  for (let i = 0; i < 245 && cb; i++) { const current = cb; t += i % 2 ? 8.33 : 16.67; current(t); }
  assert.deepStrictEqual(heard, []);
}
console.log('display_refresh_notify_test: listeners hear the measured refresh, early and late, failures contained PASS');

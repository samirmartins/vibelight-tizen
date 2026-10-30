'use strict';
// Real StreamSession and FocusManager with synthetic native/host/overlay peers.
const assert = require('assert'), fs = require('fs'), vm = require('vm');

function classList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}
function element(id) {
  return {id, classList: classList(), focused: 0, blurred: 0,
    focus() { this.focused++; }, blur() { this.blurred++; }};
}

function focusFixture() {
  const c = {
    console: {log() {}, warn() {}, error() {}},
    Array, Object, Math,
    focused: []
  };
  c.focusElement = value => c.focused.push(value);
  c.blurElement = value => { value.blurred++; };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/focus-manager.js', 'utf8'), c);
  return c;
}

function sessionFixture(options = {}) {
  const calls = {stop: 0, suppressed: [], hide: 0, close: 0, busy: [], failed: []};
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => { deferred.resolve = resolve; deferred.reject = reject; });
  const c = {
    console: {log() {}, warn() {}, error() {}},
    Promise, JSON, Object, Math, Number, String, Error,
    isInGame: true,
    showApps() { throw new Error('StreamSession must not return to the menu by itself'); },
    Module: {
      _setInputSuppressed(value) { calls.suppressed.push(value); },
      stopStream() { calls.stop++; }
    },
    api: {
      quitApp() { calls.quit = (calls.quit || 0) + 1; return options.quit || deferred.promise; }
    },
    StreamOverlay: {
      hide() { calls.hide++; },
      close(value) { calls.close++; calls.closeValue = value; },
      busy(value) { calls.busy.push(value); },
      failed(value) { calls.failed.push(value); }
    }
  };
  if (options.noStop) delete c.Module.stopStream;
  c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/stream-session.js', 'utf8'), c);
  return {c, calls, deferred};
}

(async () => {
  {
    const c = focusFixture();
    const a = element('a'), b = element('b'), d = element('d');
    assert.strictEqual(c.FocusManager.open([], 0), false);
    assert.strictEqual(c.FocusManager.open([a, b, d], 1), true);
    assert.strictEqual(c.FocusManager.index(), 1);
    assert(b.classList.contains('hovered'));
    assert.strictEqual(c.focused[c.focused.length - 1], b);
    assert.strictEqual(c.FocusManager.move(1), true);
    assert.strictEqual(c.FocusManager.current(), d);
    assert.strictEqual(c.FocusManager.move(1), true);
    assert.strictEqual(c.FocusManager.current(), a, 'list wraps');
    assert.strictEqual(c.FocusManager.move(-1), true);
    assert.strictEqual(c.FocusManager.current(), d);
    assert.strictEqual(c.FocusManager.select(1), true);
    assert.strictEqual(c.FocusManager.current(), b);
    assert.strictEqual(c.FocusManager.select(9), false);
    c.FocusManager.close();
    assert.strictEqual(c.FocusManager.active(), false);
    assert(!d.classList.contains('hovered'));
    assert(b.blurred > 0, 'closing clears focus from the last item');
    assert.strictEqual(c.FocusManager.move(1), false);
  }

  {
    const {c, calls} = sessionFixture();
    assert.strictEqual(c.StreamSession.disconnect(), true);
    assert.strictEqual(calls.stop, 1);
    assert.strictEqual(calls.hide, 1);
    assert.deepStrictEqual(calls.suppressed, [], 'the mask stays until native termination');
    assert.strictEqual(c.StreamSession.isPending(), true);
    assert.strictEqual(c.StreamSession.disconnect(), false);
    assert.strictEqual(calls.stop, 1, 'a second click never stops twice');
    c.StreamSession.terminated();
    assert.deepStrictEqual(calls.suppressed, [0]);
    assert.strictEqual(calls.close, 1);
    assert.strictEqual(c.StreamSession.isPending(), false);
    assert.strictEqual(c.StreamSession.disconnect(), true, 'the next stream can end normally');
    assert.strictEqual(calls.stop, 2);
  }

  {
    const {c, calls, deferred} = sessionFixture();
    assert.strictEqual(c.StreamSession.endHostGame(), true);
    assert.strictEqual(c.StreamSession.endHostGame(), false);
    assert.strictEqual(calls.quit, 1, 'one host request owns the action');
    assert.deepStrictEqual(calls.busy, [true]);
    assert.strictEqual(calls.stop, 0);
    deferred.resolve('xml');
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(calls.stop, 1);
    assert.strictEqual(calls.hide, 1, 'the panel hides while the native mask stays until termination');
    assert.strictEqual(c.StreamSession.isPending(), true, 'native termination still owns the end');
    c.StreamSession.terminated();
    assert.strictEqual(c.StreamSession.isPending(), false);
  }

  {
    const {c, calls, deferred} = sessionFixture();
    c.StreamSession.endHostGame();
    deferred.reject(new Error('host refused'));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(calls.stop, 0, 'a failed host request keeps the stream alive');
    assert.deepStrictEqual(calls.busy, [true, false]);
    assert.deepStrictEqual(calls.failed, ['Could not close the game on the PC.']);
    assert.strictEqual(c.StreamSession.isPending(), false);
  }

  {
    const {c, calls} = sessionFixture({noStop: true});
    assert.strictEqual(c.StreamSession.disconnect(), false);
    assert.deepStrictEqual(calls.suppressed, [0], 'a failed stop releases the mask');
    assert.deepStrictEqual(calls.failed, ['Could not stop the stream.']);
    assert.strictEqual(c.StreamSession.isPending(), false);
  }

  const source = fs.readFileSync('wasm/platform/stream-session.js', 'utf8');
  assert(!/setTimeout|setInterval|requestAnimationFrame/.test(source), 'no timer or frame loop');
  assert(!/showApps\(|Navigation\./.test(source), 'native termination owns the single return');
  console.log('stream_session_test: idempotent disconnect/end-on-PC, failure paths, mask release, single return and FocusManager wrap/close PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

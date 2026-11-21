'use strict';
// Keyboard shortcuts sent from the stream menu: exact key sequences as a real
// keyboard would send them, modifiers always released, no work outside a send.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const source = fs.readFileSync('wasm/platform/stream-shortcuts.js', 'utf8');
const DOWN = 3, UP = 4, ALT = 4;   // KEY_ACTION_DOWN, KEY_ACTION_UP, MODIFIER_ALT in moonlight-common-c

function env(options = {}) {
  const sent = [], timers = new Map(), state = {nextTimer: 1};
  const context = vm.createContext({
    isInGame: options.inGame !== false, Array, Object, Number, String,
    Module: options.noModule ? undefined : {sendKeyboardEvent(code, action, modifiers) {
      if (options.failAt !== undefined && !state.failed && sent.length === options.failAt) { state.failed = true; throw Error('native failure'); }
      sent.push([code, action, modifiers]);
    }},
    setTimeout(fn, ms) { const id = state.nextTimer++; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context);
  const run = () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); };
  return {api: context.StreamShortcuts, sent, timers, run, context};
}
const plain = value => JSON.parse(JSON.stringify(value));

// No timer, no work at load; the list is fixed and ordered.
{
  const {api, timers, sent} = env();
  assert.strictEqual(timers.size, 0);
  assert.deepStrictEqual(sent, []);
  assert.deepStrictEqual(plain(api.list()), [
    {id: 'esc', label: 'Esc'}, {id: 'alt-tab', label: 'Alt+Tab'}, {id: 'win', label: 'Win'},
    {id: 'win-d', label: 'Win+D'}, {id: 'alt-enter', label: 'Alt+Enter'}, {id: 'enter', label: 'Enter'}]);
}

// Exact sequences: modifiers go down first and come up last; Alt flags the keys while held.
const EXPECTED = {
  'esc': [[27, DOWN, 0], [27, UP, 0]],
  'alt-tab': [[18, DOWN, ALT], [9, DOWN, ALT], [9, UP, ALT], [18, UP, 0]],
  'win': [[91, DOWN, 0], [91, UP, 0]],
  'win-d': [[91, DOWN, 0], [68, DOWN, 0], [68, UP, 0], [91, UP, 0]],
  'alt-enter': [[18, DOWN, ALT], [13, DOWN, ALT], [13, UP, ALT], [18, UP, 0]],
  'enter': [[13, DOWN, 0], [13, UP, 0]]
};
for (const [id, events] of Object.entries(EXPECTED)) {
  const e = env();
  assert.strictEqual(e.api.send(id), true, id);
  const downs = events.filter(event => event[1] === DOWN);
  assert.deepStrictEqual(e.sent, downs, id + ': only presses until the hold time ends');
  assert.strictEqual(e.timers.size, 1);
  assert.strictEqual([...e.timers.values()][0].ms, 40, 'a short hold lets the PC register the keys');
  assert.strictEqual(e.api.busy(), true);
  e.run();
  assert.deepStrictEqual(e.sent, events, id);
  assert.strictEqual(e.timers.size, 0);
  assert.strictEqual(e.api.busy(), false);
}

// Nothing is sent without an active stream or without the native function.
for (const options of [{inGame: false}, {noModule: true}]) {
  const e = env(options);
  assert.strictEqual(e.api.send('esc'), false);
  assert.deepStrictEqual(e.sent, []);
  assert.strictEqual(e.timers.size, 0);
}
{
  const e = env();
  assert.strictEqual(e.api.send('unknown'), false);
  assert.strictEqual(e.api.send(''), false);
  assert.strictEqual(e.api.send('__proto__'), false);
  assert.deepStrictEqual(e.sent, []);
}

// One shortcut at a time: a second request during the hold is ignored.
{
  const e = env();
  assert.strictEqual(e.api.send('win-d'), true);
  assert.strictEqual(e.api.send('esc'), false);
  assert.strictEqual(e.timers.size, 1);
  e.run();
  assert.strictEqual(e.sent.length, 4);
  assert.strictEqual(e.api.send('esc'), true, 'free again after the keys are released');
}

// Cancelling during the hold releases every pressed key now, in reverse order, and drops the timer.
{
  const e = env();
  e.api.send('alt-tab');
  assert.strictEqual(e.api.cancel(), true);
  assert.deepStrictEqual(e.sent.slice(2), [[9, UP, ALT], [18, UP, 0]]);
  assert.strictEqual(e.timers.size, 0);
  assert.strictEqual(e.api.busy(), false);
  assert.strictEqual(e.api.cancel(), false, 'nothing left to cancel');
}

// A native failure while pressing releases what was already pressed and reports failure.
{
  const e = env({failAt: 1});            // Win goes down, the native call fails on D
  const result = e.api.send('win-d');
  assert.strictEqual(result, false, 'the second key press failed');
  assert.deepStrictEqual(e.sent, [[91, DOWN, 0], [91, UP, 0]], 'Win is released');
  assert.strictEqual(e.timers.size, 0);
  assert.strictEqual(e.api.busy(), false);
}
{
  const e = env({failAt: 0});
  assert.strictEqual(e.api.send('esc'), false, 'the first press failed: nothing was pressed');
  assert.deepStrictEqual(e.sent, [], 'nothing to release');
}

// A failure while releasing still tries every remaining key.
{
  const e = env();
  e.api.send('alt-tab');
  let calls = 0;
  e.context.Module.sendKeyboardEvent = (code, action, modifiers) => { calls++; if (code === 9) throw Error('release failed'); e.sent.push([code, action, modifiers]); };
  e.run();
  assert.strictEqual(calls, 2, 'both keys were attempted');
  assert.deepStrictEqual(e.sent.slice(-1), [[18, UP, 0]], 'Alt is released even though Tab failed');
  assert.strictEqual(e.api.busy(), false);
}
console.log('stream_shortcuts_test: six exact key sequences, hold then release, one at a time, cancel and failure release every key, nothing without a stream PASS');

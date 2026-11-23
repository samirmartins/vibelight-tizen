'use strict';
// Wake and play, rules only: when Play offers to wake the PC, and which choice is remembered.
// Independent of the older wake tests; no DOM, no timers.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const context = vm.createContext({String});
vm.runInContext(fs.readFileSync('wasm/platform/wake-and-play.js', 'utf8'), context);
const api = context.WakeAndPlay;
const MAC = '12:34:56:78:9A:BC';

function storage(initial = {}, options = {}) {
  const data = Object.assign({}, initial);
  return {
    getItem(key) { if (options.broken) throw new Error('storage blocked'); return key in data ? data[key] : null; },
    setItem(key, value) { if (options.broken) throw new Error('storage blocked'); data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    data,
  };
}

// The stored policy: three choices, "ask" when nothing valid is stored or storage fails.
assert.deepStrictEqual(Array.from(api.POLICIES), ['ask', 'wake', 'never']);
assert.strictEqual(api.DEFAULT, 'ask');
assert.strictEqual(api.policy(storage()), 'ask');
for (const value of ['ask', 'wake', 'never']) assert.strictEqual(api.policy(storage({[api.KEY]: value})), value);
for (const value of ['', 'ALWAYS', 'true', '1', 'Wake']) assert.strictEqual(api.policy(storage({[api.KEY]: value})), 'ask', 'invalid ' + value);
assert.strictEqual(api.policy(storage({}, {broken: true})), 'ask');
assert.strictEqual(api.policy(null), 'ask');

// Saving: only valid values are stored, and a blocked storage never throws.
const store = storage();
assert.strictEqual(api.setPolicy(store, 'wake'), true);
assert.strictEqual(store.data[api.KEY], 'wake');
assert.strictEqual(api.setPolicy(store, 'sometimes'), false);
assert.strictEqual(store.data[api.KEY], 'wake', 'an invalid value keeps the saved choice');
assert.strictEqual(api.setPolicy(storage({}, {broken: true}), 'never'), false);
api.setPolicy(store, 'ask');
assert.strictEqual(api.policy(store), 'ask');

// The settings button cycles ask -> wake -> never -> ask; anything unknown starts again at the default.
assert.strictEqual(api.nextPolicy('ask'), 'wake');
assert.strictEqual(api.nextPolicy('wake'), 'never');
assert.strictEqual(api.nextPolicy('never'), 'ask');
assert.strictEqual(api.nextPolicy('x'), 'wake');
assert.strictEqual(api.nextPolicy(undefined), 'wake');

// Play only changes for a PC known to be off with a MAC to wake; every other case plays as before.
const cases = [
  // policy, state, mac, expected
  ['ask', 'offline', MAC, 'ask'],
  ['wake', 'offline', MAC, 'wake'],
  ['never', 'offline', MAC, 'play'],
  ['ask', 'online', MAC, 'play'],
  ['wake', 'online', MAC, 'play'],
  ['ask', 'unknown', MAC, 'play'],      // a check still running is not proof the PC is off
  ['wake', 'unknown', MAC, 'play'],
  ['ask', 'offline', '', 'play'],       // nothing to wake without a MAC
  ['wake', 'offline', null, 'play'],
  ['wake', 'offline', undefined, 'play'],
  ['bogus', 'offline', MAC, 'ask'],     // an invalid stored policy behaves as the default
  [undefined, 'offline', MAC, 'ask'],
  ['wake', 'offline-ish', MAC, 'play'],
];
for (const [policy, state, mac, expected] of cases) {
  assert.strictEqual(api.decide({policy, state, mac}), expected, [policy, state, mac].join(' / '));
}
assert.strictEqual(api.decide(), 'play');
assert.strictEqual(api.decide(null), 'play');

// What "remember" stores for each answer of the question.
assert.strictEqual(api.remembered('wake', true), 'wake');
assert.strictEqual(api.remembered('try', true), 'never');
assert.strictEqual(api.remembered('wake', false), null);
assert.strictEqual(api.remembered('try', false), null);
assert.strictEqual(api.remembered('cancel', true), null, 'cancelling never saves a choice');
console.log('wake_and_play_rules_test: OK');

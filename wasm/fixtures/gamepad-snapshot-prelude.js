// Shared harness for the production gamepad snapshot publisher
// (wasm/platform/gamepad.js): fake Gamepad API, heap, rAF/timers and rumble.
// Tests run it as a script prefix in one VM scope with their own scenarios;
// they may substitute the gamepad.js source and Atomics before running it.
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const listeners = {};
let rafCallback = null;
let timerCallback = null;
let now = 0;
let notifications = 0;
let rumbleCalls = [];

function makeButtons() {
  return Array.from({ length: 17 }, function() { return { value: 0, pressed: false }; });
}

const actuator = {
  playEffect: function(type, effect) {
    rumbleCalls.push({ type, effect });
    return Promise.resolve();
  },
  reset: function() { rumbleCalls.push({ type: 'reset' }); return Promise.resolve(); }
};
const pad = {
  index: 1,
  id: 'Sony DualSense Wireless Controller',
  connected: true,
  timestamp: 1,
  axes: [0, 0, 0, 0],
  buttons: makeButtons(),
  vibrationActuator: actuator
};
let pads = [null, pad];

const memory = new SharedArrayBuffer(8192);
const heap32 = new Int32Array(memory);
const snapshotPtr = 64;
const rumblePtr = 4096;
const stateWords = 7 + 8 + 17 + 17;
const payloadWords = 1 + 4 * stateWords;

const context = {
  console: { log: function() {}, warn: function() {}, error: function() {} },
  navigator: { getGamepads: function() { return pads; } },
  performance: { now: function() { return now; } },
  Module: {
    HEAP32: heap32,
    _gamepadSnapshotAddress: function() { return snapshotPtr; },
    _gamepadSnapshotMaxPads: function() { return 4; },
    _gamepadSnapshotButtonCount: function() { return 17; },
    _gamepadSnapshotStride: function() { return stateWords * 4; },
    _gamepadSnapshotWordCount: function() { return payloadWords; },
    _rumbleStateAddress: function() { return rumblePtr; },
    _notifyGamepadSnapshot: function() { notifications++; },
    _resetRumbleState: function() {
      for (let i = 0; i < 4; i++) { Atomics.store(heap32, (rumblePtr >> 2) + i, 0); }
    }
  },
  CustomEvent: function() {},
  Int32Array,
  Float32Array,
  ArrayBuffer,
  Atomics,
  Set,
  Promise,
  Math,
  Number,
  Date,
  isFinite,
  window: null
};
context.window = context;
context.addEventListener = function(name, callback) {
  (listeners[name] || (listeners[name] = [])).push(callback);
};
context.dispatchEvent = function() {};
context.requestAnimationFrame = function(callback) { rafCallback = callback; return 1; };
context.cancelAnimationFrame = function() { rafCallback = null; };
context.setTimeout = function(callback) { timerCallback = callback; return 1; };
context.clearTimeout = function() { timerCallback = null; };

vm.createContext(context);
vm.runInContext(fs.readFileSync('wasm/platform/gamepad.js', 'utf8'), context);


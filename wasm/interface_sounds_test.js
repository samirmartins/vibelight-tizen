'use strict';
// Menu-only sound policy: no context before input, no sound while streaming,
// rate-limited tones and a persisted disable switch.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
assert(fs.readFileSync('wasm/index.html', 'utf8').includes('id="interfaceSoundsSwitch"'), 'sound switch is in the settings markup');

async function fixture() {
  const listeners = Object.create(null);
  const documentListeners = Object.create(null);
  const contexts = [];
  const oscillators = [];
  let now = 0;
  let running = true;
  let switchOn = false;
  const input = {
    checked: false,
    listener: null,
    addEventListener(name, fn) { if (name === 'change') this.listener = fn; },
    fireChange() { if (this.listener) this.listener(); }
  };
  const button = {
    MaterialSwitch: {
      on() { switchOn = true; },
      off() { switchOn = false; }
    }
  };
  const restore = { listener: null, addEventListener(name, fn) { if (name === 'click') this.listener = fn; } };
  const document = {
    hidden: false,
    activeElement: {tagName: 'BODY'},
    getElementById(id) {
      if (id === 'interfaceSoundsSwitch') return input;
      if (id === 'interfaceSoundsBtn') return button;
      if (id === 'continueRestoreDefaults') return restore;
      return null;
    },
    addEventListener(name, fn) { (documentListeners[name] || (documentListeners[name] = [])).push(fn); }
  };
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 1;
      this.destination = {};
      this.suspended = 0;
      this.closed = 0;
      contexts.push(this);
    }
    createOscillator() {
      const oscillator = {
        type: '', frequency: {value: 0, setValueAtTime(value) { this.value = value; }},
        connect() {}, disconnect() {}, start() {}, stop() {}, onended: null
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      return {gain: {setValueAtTime() {}, exponentialRampToValueAtTime() {}}, connect() {}, disconnect() {}};
    }
    suspend() { this.state = 'suspended'; this.suspended++; return Promise.resolve(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; this.closed++; return Promise.resolve(); }
  }
  const store = new Map();
  const window = {
    AudioContext: FakeAudioContext,
    addEventListener(name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); },
    dispatchEvent(name, event) {
      (listeners[name] || []).slice().forEach(fn => fn(event));
    }
  };
  const context = {
    window,
    document,
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); }
    },
    Navigation: {isRunning() { return running; }},
    isInGame: false,
    performance: {now() { return now; }},
    console: {log() {}, warn() {}, error() {}},
    Promise, Number, String, Object, Array, Date, isFinite
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('wasm/platform/interface-sounds.js', 'utf8'), context);
  (documentListeners.DOMContentLoaded || []).forEach(fn => fn());
  (listeners.load || []).forEach(fn => fn());
  return {
    context, window, document, input, button, restore, contexts, oscillators, listeners,
    setRunning(value) { running = value; },
    setNow(value) { now = value; },
    fire(name, event) { window.dispatchEvent(name, event || {}); },
    key(code, repeat) { window.dispatchEvent('keydown', {keyCode: code, which: code, repeat: !!repeat}); },
    gamepad(changes, index) {
      window.dispatchEvent('gamepadinputchanged', {detail: {changes, padIndex: index || 0}});
    }
  };
}

(async () => {
  {
    const f = await fixture();
    assert.strictEqual(f.context.InterfaceSounds.isEnabled(), true);
    assert.strictEqual(f.button.MaterialSwitch ? f.context.InterfaceSounds.isEnabled() : false, true);
    assert.strictEqual(f.contexts.length, 0, 'no AudioContext at startup');
    assert.strictEqual(f.oscillators.length, 0);
    f.gamepad([{type: 'button', index: 0, pressed: true}]);
    assert.strictEqual(f.contexts.length, 1, 'gamepad creates the context');
    assert.strictEqual(f.oscillators.length, 1);
    assert.strictEqual(f.oscillators[0].frequency.value, 1320);

    f.setNow(50);
    f.key(40);
    assert.strictEqual(f.oscillators.length, 2);
    assert.strictEqual(f.oscillators[1].frequency.value, 880);
    f.setNow(100);
    f.key(13);
    assert.strictEqual(f.oscillators.length, 3);
    assert.strictEqual(f.oscillators[2].frequency.value, 1320);
    f.key(13, true);
    assert.strictEqual(f.oscillators.length, 3, 'held confirm is ignored');
    f.setNow(150);
    f.key(27);
    assert.strictEqual(f.oscillators.length, 4);
    assert.strictEqual(f.oscillators[3].frequency.value, 660);

    f.setNow(200);
    f.gamepad([{type: 'button', index: 2, pressed: true}]);
    assert.strictEqual(f.oscillators.length, 5, 'face buttons tick');
    f.setNow(250);
    f.gamepad([{type: 'axis', index: 0, value: 0.8}]);
    assert.strictEqual(f.oscillators.length, 6);
    f.gamepad([{type: 'axis', index: 0, value: 0.9}]);
    assert.strictEqual(f.oscillators.length, 6, 'held axis does not repeat');
    f.setNow(300);
    f.gamepad([{type: 'axis', index: 3, value: -0.8}]);
    assert.strictEqual(f.oscillators.length, 7, 'right stick movement ticks');

    f.context.isInGame = true;
    f.key(40);
    assert.strictEqual(f.oscillators.length, 7, 'no sounds during streaming');
    f.context.isInGame = false;
    f.document.hidden = true;
    f.key(40);
    assert.strictEqual(f.oscillators.length, 7, 'no sounds while hidden');
    f.document.hidden = false;

    f.input.checked = false;
    f.input.fireChange();
    assert.strictEqual(f.context.InterfaceSounds.isEnabled(), false);
    assert.strictEqual(f.contexts[0].state, 'suspended');
    f.key(40);
    assert.strictEqual(f.oscillators.length, 7, 'disable switch stops tones');
    f.context.InterfaceSounds.setEnabled(true);
    assert.strictEqual(f.input.checked, true);

    f.context.InterfaceSounds.stop();
    assert.strictEqual(f.contexts[0].closed, 1, 'stream start closes the menu context');
    f.setNow(350);
    f.context.InterfaceSounds.start();
    assert.strictEqual(f.contexts.length, 1, 'no context is created on Navigation.start');
    f.key(40);
    assert.strictEqual(f.contexts.length, 2, 'first menu input recreates the context');
    assert.strictEqual(f.oscillators.length, 8);

    f.input.checked = false;
    f.input.fireChange();
    f.restore.listener();
    assert.strictEqual(f.context.InterfaceSounds.isEnabled(), true, 'restore defaults re-enables sounds');
  }
  {
    const f = await fixture();
    f.key(40);
    assert.strictEqual(f.oscillators.length, 1);
    f.setNow(100);
    f.document.activeElement = {tagName: 'INPUT', type: 'text'};
    f.key(40);
    assert.strictEqual(f.oscillators.length, 1, 'text entry stays silent');
    f.setNow(200);
    f.document.activeElement = {tagName: 'INPUT', type: 'checkbox'};
    f.key(40);
    assert.strictEqual(f.oscillators.length, 2, 'switch focus still ticks');
    f.setNow(300);
    f.document.activeElement = {tagName: 'INPUT', type: 'range'};
    f.key(40);
    assert.strictEqual(f.oscillators.length, 3, 'range focus still ticks');
    f.setNow(400);
    f.document.activeElement = {tagName: 'TEXTAREA'};
    f.key(13);
    assert.strictEqual(f.oscillators.length, 3, 'textarea stays silent');
  }
  console.log('interface_sounds_test: menu-only context, tones, input focus, rate limit, disable and streaming gates PASS');
})();

'use strict';
// Real overlay, focus, session and message dispatch with synthetic DOM, TV
// volume API, gamepads and native stop. Not a Tizen or real-TV emulator.
const assert = require('assert'), fs = require('fs'), vm = require('vm');

function makeElement(tag, id) {
  const classes = new Set();
  const node = {
    tagName: (tag || 'div').toUpperCase(), id: id || '', className: '', textContent: '',
    hidden: false, attrs: {}, children: [], style: {}, focused: 0, blurred: 0,
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); }
    },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] === undefined ? null : this.attrs[name]; },
    focus() { this.focused++; },
    blur() { this.blurred++; }
  };
  return node;
}

function findByElement(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (let index = 0; index < (root.children || []).length; index++) {
    const found = findByElement(root.children[index], id);
    if (found) return found;
  }
  return null;
}

function fixture(options = {}) {
  let now = 0, nextFrame = 1, nextTimer = 1;
  const frames = new Map(), timers = new Map(), listeners = {};
  const nodes = new Map(), pads = [];
  const calls = {suppressed: [], stop: 0, toggleStats: 0, quit: 0, showApps: 0};
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => { deferred.resolve = resolve; deferred.reject = reject; });

  const document = {
    hidden: false,
    body: makeElement('body', 'body'),
    createElement(tag) {
      const node = makeElement(tag);
      node.ownerDoc = document;
      return node;
    },
    getElementById(id) {
      if (!nodes.has(id)) {
        const found = findByElement(document.body, id);
        if (found) {
          nodes.set(id, found);
          return found;
        }
        const node = makeElement('div', id);
        node.ownerDoc = document;
        nodes.set(id, node);
      }
      return nodes.get(id);
    },
    addEventListener(name, handler) { (listeners[name] = listeners[name] || []).push(handler); }
  };
  document.body.ownerDoc = document;

  const store = new Map();
  if (options.stored !== undefined) store.set('vibelight.stream-overlay.v1', options.stored);

  const c = {
    console: {log() {}, warn() {}, error() {}},
    Promise, JSON, Object, Array, Math, Number, String, isFinite, Error, parseInt,
    document,
    navigator: {language: 'pt-BR', getGamepads() { return pads; }},
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); }
    },
    isInGame: true,
    Module: {
      _setInputSuppressed(value) { calls.suppressed.push(value); },
      stopStream() { calls.stop++; },
      toggleStats() { calls.toggleStats++; }
    },
    SessionDiagnostics:{isVisible(){return !!c.statsVisible;},isRecording(){return !!c.statsVisible;}},
    api: {
      quitApp() { calls.quit++; return options.quit || deferred.promise; }
    },
    tizen: {
      tvaudiocontrol: {
        volume: options.volume === undefined ? 30 : options.volume,
        muted: false,
        getVolume() { return this.volume; },
        setVolume(value) { this.volume = value; },
        setVolumeUp() { this.volume += 1; },
        setVolumeDown() { this.volume -= 1; },
        getMute() { return this.muted; },
        setMute(value) { this.muted = !!value; }
      }
    },
    setTimeout(handler, ms) { const id = nextTimer++; timers.set(id, {handler, ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    focusElement(element) { c.focusedElement = element; },
    blurElement(element) { if (element) element.blur(); }
  };
  c.window = c;
  c.window.requestAnimationFrame = handler => { const id = nextFrame++; frames.set(id, handler); return id; };
  c.window.cancelAnimationFrame = id => { frames.delete(id); };
  c.document.activeElement = null;

  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/menu-translations.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync('wasm/platform/menu-i18n.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync('wasm/platform/focus-manager.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync('wasm/platform/stream-session.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync('wasm/platform/stream-shortcuts.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync('wasm/platform/stream-overlay.js', 'utf8'), c);

  function frame() {
    assert(frames.size > 0, 'expected a scheduled animation frame');
    const first = frames.entries().next().value;
    frames.delete(first[0]);
    first[1](now);
  }
  function step(ms) { now += ms === undefined ? 16 : ms; frame(); }
  function pad(state = {}) {
    const buttons = [];
    for (let index = 0; index < 17; index++) buttons.push({pressed: !!state[index], value: state[index] ? 1 : 0});
    return {index: 0, connected: true, timestamp: 1, buttons, axes: [0, 0, 0, 0]};
  }
  function setPad(state) { pads.length = 0; pads.push(pad(state)); }
  function press(state) { setPad(state); step(); }
  function release() { setPad({}); step(); }
  function text(id) { return c.document.getElementById(id).textContent; }

  return {
    c, calls, frames, timers, pads, deferred, nodes, document, store, listeners,
    frame, step, setPad, press, release, text,
    flush() { return new Promise(resolve => setImmediate(resolve)); }
  };
}

module.exports = {fixture};

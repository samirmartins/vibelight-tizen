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

(async () => {
  {
    const f = fixture();
    assert.strictEqual(f.frames.size, 0, 'no frame at load');
    assert.deepStrictEqual(f.calls.suppressed, []);

    f.setPad({});
    assert.strictEqual(f.c.StreamOverlay.open(), true);
    assert.deepStrictEqual(f.calls.suppressed, [1]);
    assert.strictEqual(f.frames.size, 1);
    assert.strictEqual(f.document.getElementById('streamOverlay').hidden, false);
    assert.strictEqual(f.text('streamOverlay-resume'), 'Retomar', 'bundled pt-BR label');
    assert.strictEqual(f.text('streamOverlay-disconnect'), 'Desconectar');
    assert.strictEqual(f.text('streamOverlay-end'), 'Encerrar jogo no PC');
    f.step(); // prime the pad without acting on a held button

    // Navigation wraps and repeats without an interval timer.
    f.press({13: true});
    assert.strictEqual(f.c.FocusManager.index(), 1);
    f.release();
    f.press({13: true});
    assert.strictEqual(f.c.FocusManager.index(), 2);
    f.release();
    f.press({15: true});
    f.release();
    assert.strictEqual(f.c.FocusManager.index(), 3, 'right moves when the item has no adjust step');
    f.c.FocusManager.select(2);

    // Statistics uses the existing native toggle and the saved switch state.
    f.press({0: true});
    f.release();
    assert.strictEqual(f.calls.toggleStats, 1);
    f.document.getElementById('performanceStatsSwitch').checked = true;
    f.c.StreamOverlay.refresh();
    assert.strictEqual(f.text('streamOverlay-stats'), 'Estatísticas: ativadas');

    // Volume step comes from the overlay config and mute is visible.
    f.c.FocusManager.select(1);
    f.press({15: true});
    f.release();
    assert.strictEqual(f.c.tizen.tvaudiocontrol.volume, 35);
    f.press({0: true});
    f.release();
    assert.strictEqual(f.c.tizen.tvaudiocontrol.muted, true);
    assert.strictEqual(f.text('streamOverlay-volume'), 'Volume: mudo');
    f.press({0: true});
    f.release();
    assert.strictEqual(f.c.tizen.tvaudiocontrol.muted, false);

    // Closing keeps the mask until the pad is neutral, then stops the frame loop.
    f.c.FocusManager.select(0);
    f.press({0: true});
    assert.strictEqual(f.document.getElementById('streamOverlay').hidden, true);
    assert.deepStrictEqual(f.calls.suppressed, [1], 'mask held while A is still down');
    assert.strictEqual(f.frames.size, 1, 'only the release gate keeps running');
    f.release();
    assert.deepStrictEqual(f.calls.suppressed, [1, 0]);
    assert.strictEqual(f.frames.size, 0);
    assert.strictEqual(f.timers.size, 0);
    assert(f.document.getElementById('wasm_module').focused > 0, 'keyboard focus returns to the stream canvas');
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.press({16: true}); // Guide opens/closes through the native signal in messages.js
    f.release();
    assert.strictEqual(f.c.StreamOverlay.isOpen(), false);
    assert.deepStrictEqual(f.calls.suppressed, [1, 0]);
    assert.strictEqual(f.frames.size, 0);
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.press({8: true, 9: true});
    f.release();
    assert.strictEqual(f.c.StreamOverlay.isOpen(), false, 'Back+Start fallback closes the menu');
  }

  {
    const f = fixture();
    f.c.StreamOverlay.controllerLost(0);
    assert.strictEqual(f.document.getElementById('streamOverlayNotice').hidden, false);
    assert.strictEqual(f.document.getElementById('streamOverlayNotice').textContent, 'Controle desconectado');
    f.c.StreamOverlay.controllerLost(1);
    assert.strictEqual(f.document.getElementById('streamOverlayNotice').textContent, 'Controles desconectados');
    f.c.StreamOverlay.controllerFound(0);
    f.c.StreamOverlay.controllerFound(1);
    assert.strictEqual(f.document.getElementById('streamOverlayNotice').hidden, true);
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.c.FocusManager.select(3);
    f.press({0: true});
    assert.strictEqual(f.calls.stop, 1, 'one native stop');
    assert.strictEqual(f.c.StreamOverlay.isOpen(), false);
    assert.strictEqual(f.document.getElementById('streamOverlay').hidden, true);
    assert.strictEqual(f.frames.size, 0, 'no frame loop during teardown');
    assert.deepStrictEqual(f.calls.suppressed, [1], 'teardown keeps the mask');
    f.c.StreamSession.terminated();
    assert.deepStrictEqual(f.calls.suppressed, [1, 0]);
    assert.strictEqual(f.frames.size, 0);
    assert.strictEqual(f.timers.size, 0);
    assert.strictEqual(f.c.StreamSession.isPending(), false);
    // A second click cannot stop twice.
    assert.strictEqual(f.c.StreamSession.disconnect(), true);
    assert.strictEqual(f.calls.stop, 2);
    f.c.StreamSession.terminated();
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.c.FocusManager.select(4);
    f.press({0: true});
    f.release();
    assert.strictEqual(f.document.getElementById('streamOverlayConfirm').hidden, false);
    assert.strictEqual(f.c.FocusManager.count(), 2);
    f.press({1: true}); // B cancels the confirmation
    f.release();
    assert.strictEqual(f.document.getElementById('streamOverlayConfirm').hidden, true);
    assert.strictEqual(f.c.FocusManager.index(), 4);
    f.press({0: true});
    f.release();
    f.press({0: true}); // Yes
    f.release();
    assert.strictEqual(f.calls.quit, 1);
    assert.strictEqual(f.calls.stop, 0);
    assert.strictEqual(f.c.StreamSession.isPending(), true);
    f.deferred.resolve('xml');
    await f.flush();
    assert.strictEqual(f.calls.stop, 1);
    assert.strictEqual(f.c.StreamOverlay.isOpen(), false);
    f.c.StreamSession.terminated();
    assert.strictEqual(f.calls.suppressed[f.calls.suppressed.length - 1], 0);
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.c.FocusManager.select(4);
    f.press({0: true});
    f.release();
    f.press({0: true});
    f.release();
    f.deferred.reject(new Error('host refused'));
    await f.flush();
    assert.strictEqual(f.calls.stop, 0, 'the stream survives a failed host request');
    assert.strictEqual(f.c.StreamOverlay.isOpen(), true);
    assert.strictEqual(f.document.getElementById('streamOverlayStatus').textContent,
      'Não foi possível encerrar o jogo no PC.');
    assert.strictEqual(f.c.StreamSession.isPending(), false);
    f.c.StreamOverlay.close(true);
    assert.deepStrictEqual(f.calls.suppressed, [1, 0]);
  }

  {
    const f = fixture({stored: '{broken'});
    f.setPad({});
    assert.strictEqual(f.c.StreamOverlay.open(), true, 'a malformed config falls back to defaults');
    assert.strictEqual(f.c.StreamOverlay.config().volumeStep, 5);
    f.c.StreamOverlay.close(true);
    assert.strictEqual(f.c.StreamOverlay.configure({volumeStep: 0}).volumeStep, 1);
    assert.strictEqual(f.c.StreamOverlay.configure({volumeStep: 99}).volumeStep, 20);
    assert.strictEqual(JSON.parse(f.store.get('vibelight.stream-overlay.v1')).volumeStep, 20);
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.document.hidden = true;
    assert(f.listeners.visibilitychange && f.listeners.visibilitychange.length === 1);
    f.listeners.visibilitychange.forEach(handler => handler());
    assert.strictEqual(f.document.getElementById('streamOverlay').hidden, true);
    assert.strictEqual(f.frames.size, 0);
    assert.strictEqual(f.calls.suppressed[f.calls.suppressed.length - 1], 0);
  }

  const source = fs.readFileSync('wasm/platform/stream-overlay.js', 'utf8');
  assert(!/setInterval/.test(source), 'no interval while streaming');
  assert(!/requestAnimationFrame/.test(source.split('function startFrames')[0]), 'no frame loop before the menu opens');
  const indexSource = fs.readFileSync('wasm/platform/index.js', 'utf8');
  const showAppsMode = indexSource.slice(
    indexSource.indexOf('function showAppsMode()'), indexSource.indexOf('// Show the Apps grid'));
  assert(showAppsMode.includes('StreamOverlay.close(true)'), 'every menu return closes the overlay');
  assert(showAppsMode.includes('StreamSession.reset()'), 'every menu return clears a pending stop');

  // Thin message dispatch: the native signals are the only entry points.
  {
    const calls = {toggled: 0, lost: [], found: [], terminated: 0};
    const c = {
      console: {log() {}, warn() {}, error() {}},
      Promise, JSON, parseInt, Object, Math, Number, String,
      isInGame: true,
      document: {hidden: false},
      SessionDiagnostics: {finish() {}, sample() {}, note() {}, connected() {}},
      stopVideoPresentationObserver() {}, stopAudioScheduler() {},
      snackbarLogLong() {}, warningDialog() {},
      $() { return {css() { return this; }, removeClass() { return this; }, addClass() { return this; }, prop() { return false; }}; },
      showApps() { calls.showApps = (calls.showApps || 0) + 1; },
      StreamOverlay: {
        toggle() { calls.toggled++; },
        controllerLost(value) { calls.lost.push(value); },
        controllerFound(value) { calls.found.push(value); }
      },
      StreamSession: {terminated() { calls.terminated++; }},
      setTimeout() { return 1; },
      api: {},
      AppLifecycle: undefined
    };
    c.window = c;
    vm.createContext(c);
    vm.runInContext(fs.readFileSync('wasm/platform/messages.js', 'utf8'), c);
    c.handleMessage('guideButton');
    c.handleMessage('controllerLost: 2');
    c.handleMessage('controllerFound: 2');
    c.handleMessage('streamTerminated: 0');
    assert.strictEqual(calls.toggled, 1);
    assert.deepStrictEqual(calls.lost, [2]);
    assert.deepStrictEqual(calls.found, [2]);
    assert.strictEqual(calls.terminated, 1);
    assert.strictEqual(calls.showApps, 1, 'the termination handler still owns the single return');
    c.isInGame = false;
    c.handleMessage('guideButton');
    assert.strictEqual(calls.toggled, 1, 'Guide is inert outside a stream');
  }

  console.log('stream_overlay_test: atomic mask, Guide/fallback, pt-BR labels, navigation, volume, stats, disconnect, confirmed end-on-PC, lost-controller notice, config and message dispatch PASS (synthetic inputs)');
})().catch(error => { console.error(error); process.exitCode = 1; });

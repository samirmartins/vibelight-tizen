'use strict';
// Menu-only screensaver: one idle timer, dim/wake, settings and lifecycle.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('wasm/index.html', 'utf8');
assert(html.includes('id="selectScreensaver"'), 'screensaver control is in the settings markup');
const advancedAt = html.indexOf('id="advancedSettings"');
const videoAt = html.indexOf('id="videoSettings"');
const statsAt = html.indexOf('<label>Performance statistics</label>', advancedAt);
const screensaverAt = html.indexOf('<label>Screensaver</label>', advancedAt);
const diagnosisAt = html.indexOf('<label>Session diagnosis</label>', advancedAt);
assert(videoAt >= 0 && advancedAt > videoAt, 'settings sections remain ordered');
assert(statsAt < screensaverAt && screensaverAt < diagnosisAt, 'screensaver sits between performance statistics and session diagnosis');
assert(!html.slice(videoAt, advancedAt).includes('selectScreensaver'), 'screensaver is not left in Video');

function element(tag, id, className) {
  const classes = new Set(className ? className.split(/\s+/) : []);
  return {
    tagName: String(tag || 'div').toUpperCase(), id: id || '', className: className || '',
    hidden: false, textContent: '', attrs: {}, children: [], style: {}, parentNode: null,
    listeners: Object.create(null),
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); }
    },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] === undefined ? null : this.attrs[name]; },
    addEventListener(name, fn) { (this.listeners[name] || (this.listeners[name] = [])).push(fn); },
    fire(name, event) { (this.listeners[name] || []).slice().forEach(fn => fn(event || {})); },
    closest(selector) { return selector === '.setting-option' ? this.option : null; },
    querySelector(selector) { return selector === '.mdl-menu' ? this.menu : null; }
  };
}

function fixture() {
  let now = 0, nextTimer = 1;
  const timers = new Map(), windowListeners = Object.create(null);
  const documentListeners = Object.create(null);
  let running = true, dialog = false, hidden = false;
  let pushes = 0, pops = 0, viewActive = false, lastView = null;
  const button = element('button', 'selectScreensaver');
  const menu = element('ul', null, 'mdl-menu');
  const option = element('div', null, 'setting-option');
  button.option = option;
  button.menu = menu;
  option.menu = menu;
  option.appendChild(menu);
  const items = [0, 1, 5, 10].map(value => {
    const item = element('li', null, 'mdl-menu__item');
    item.setAttribute('data-value', String(value));
    item.textContent = String(value);
    menu.appendChild(item);
    return item;
  });
  const restore = element('button', 'continueRestoreDefaults');
  const body = element('body');
  const document = {
    get hidden() { return hidden; },
    set hidden(value) { hidden = !!value; },
    body,
    activeElement: {tagName: 'BODY'},
    getElementById(id) {
      if (id === 'selectScreensaver') return button;
      if (id === 'continueRestoreDefaults') return restore;
      return null;
    },
    createElement(tag) { return element(tag); },
    addEventListener(name, fn) { (documentListeners[name] || (documentListeners[name] = [])).push(fn); }
  };
  const store = new Map();
  const window = {
    addEventListener(name, fn) { (windowListeners[name] || (windowListeners[name] = [])).push(fn); },
    dispatchEvent(name, event) { (windowListeners[name] || []).slice().forEach(fn => fn(event || {})); },
    requestAnimationFrame() { throw Error('screensaver must not depend on animation frames'); },
    cancelAnimationFrame() {}
  };
  const context = {
    window, document,
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); }
    },
    Navigation: {
      isRunning() { return running; },
      push(view) { pushes++; lastView = view; },
      pop() { pops++; }
    },
    Views: {
      SelectScreensaverMenu: {
        isActive() { return viewActive; },
        view: {index: 0}
      }
    },
    MenuI18n: {text(value) { return value; }},
    isInGame: false,
    isDialogOpen: false,
    performance: {now() { return now; }},
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, {fn, at: now + ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    console: {log() {}, warn() {}, error() {}},
    Promise, Number, String, Object, Array, Date, isFinite, parseInt
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('wasm/platform/ambient-mode.js', 'utf8'), context);
  (windowListeners.load || []).forEach(fn => fn());
  function advance(ms) {
    now += ms;
    const due = Array.from(timers.entries()).filter(([, value]) => value.at <= now);
    due.forEach(([id, value]) => { timers.delete(id); value.fn(); });
  }
  return {
    context, document, window, button, menu, items, restore, timers, body,
    advance,
    setRunning(value) { running = value; },
    setDialog(value) { dialog = !!value; context.isDialogOpen = dialog; },
    setHidden(value) { hidden = value; },
    setViewActive(value) { viewActive = value; },
    counts() { return {pushes, pops, timers: timers.size, viewIndex: lastView ? lastView.view.index : null}; },
    dispatch(name, event) { window.dispatchEvent(name, event || {}); }
  };
}

(function() {
  {
    const f = fixture();
    assert.strictEqual(f.context.AmbientMode.getMinutes(), 5);
    assert.strictEqual(f.button.getAttribute('data-value'), '5');
    assert.strictEqual(f.button.textContent, '5 minutes');
    assert.strictEqual(f.timers.size, 1, 'start schedules one idle timer');

    f.context.AmbientMode.setMinutes(1);
    assert.strictEqual(f.context.AmbientMode.getMinutes(), 1);
    assert.strictEqual(f.button.textContent, '1 minute');
    assert.strictEqual(f.timers.size, 1);
    f.advance(59999);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'not before the timeout');
    f.advance(1);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), true);
    assert.strictEqual(f.document.body.children[0].id, 'ambientOverlay');
    assert.strictEqual(f.document.body.children[0].hidden, false);
    assert.strictEqual(f.document.body.children[0].classList.contains('ambient-visible'), true);

    const key = {keyCode: 13, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }};
    f.dispatch('keydown', key);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'first key wakes');
    assert.strictEqual(key.prevented, true);
    assert.strictEqual(key.stopped, true);
    assert.strictEqual(f.document.body.children[0].hidden, true);
    assert.strictEqual(f.timers.size, 1, 'wake resets the timer');

    f.advance(60000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), true);
    const pad = {preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }};
    f.dispatch('gamepadinputchanged', {detail: {changes: [{type: 'button', index: 0, pressed: true}]}});
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'fresh gamepad press wakes');
    assert.strictEqual(pad.prevented, undefined, 'custom event has no preventDefault');

    f.context.AmbientMode.setMinutes(0);
    f.advance(600000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'off never dims');
    assert.strictEqual(f.timers.size, 0);

    f.context.AmbientMode.setMinutes(1);
    f.context.AmbientMode.stop();
    f.advance(600000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'stop clears the timer');
    assert.strictEqual(f.timers.size, 0);
    f.context.AmbientMode.start();
    f.setHidden(true);
    f.advance(600000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'hidden app does not dim');
    f.setHidden(false);

    f.setDialog(true);
    f.context.AmbientMode.start();
    f.advance(60000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'dialog defers dimming');
    assert.strictEqual(f.timers.size, 1, 'dialog keeps one retry timer');
    f.setDialog(false);
    f.advance(60000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), true, 'dim resumes after dialog');

    f.restore.fire('click');
    assert.strictEqual(f.context.AmbientMode.getMinutes(), 5, 'restore defaults resets the delay');
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false);
    assert.strictEqual(f.button.textContent, '5 minutes');

    f.button.fire('click');
    assert.strictEqual(f.counts().pushes, 1, 'select opens the settings view');
    assert.strictEqual(f.counts().viewIndex, 2, 'select opens at the saved 5-minute value');
    f.setViewActive(true);
    f.button.fire('click');
    assert.strictEqual(f.counts().pops, 1, 'select closes the active view');
    f.setViewActive(false);
    f.menu.fire('click', {target: f.items[3]});
    assert.strictEqual(f.context.AmbientMode.getMinutes(), 10);
    assert.strictEqual(f.button.textContent, '10 minutes');
    f.button.fire('click');
    assert.strictEqual(f.counts().viewIndex, 3, 'reopening selects the new saved value');

    f.setRunning(false);
    f.context.AmbientMode.setMinutes(1);
    f.advance(60000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'menu must be running');
  }
  {
    const f = fixture();
    f.context.AmbientMode.setMinutes(1);
    f.dispatch('mousemove', {clientX: 100, clientY: 100});
    f.advance(30000);
    // Synthetic pointer reports at the same place, resting axis noise and a
    // trigger axis must not restart the idle timer.
    f.dispatch('mousemove', {clientX: 100, clientY: 100});
    f.dispatch('gamepadinputchanged', {detail: {changes: [{type: 'axis', index: 0, value: 0.4}], padIndex: 0}});
    f.dispatch('gamepadinputchanged', {detail: {changes: [{type: 'axis', index: 0, value: 0.1}], padIndex: 0}});
    f.dispatch('gamepadinputchanged', {detail: {changes: [{type: 'axis', index: 4, value: -1}], padIndex: 0}});
    f.dispatch('gamepadconnected', {});
    f.advance(30000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), true, 'idle noise does not keep the timer alive');
    f.dispatch('mousemove', {clientX: 100, clientY: 100});
    assert.strictEqual(f.context.AmbientMode.isDimmed(), true, 'same-coordinate pointer noise does not wake');
    f.dispatch('gamepadinputchanged', {detail: {changes: [{type: 'axis', index: 0, value: 0.8}], padIndex: 0}});
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'a real stick movement wakes the dimmed menu');
    f.advance(60000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), true);
    f.dispatch('mousemove', {clientX: 108, clientY: 100});
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'real pointer movement wakes');
  }
  {
    const f = fixture();
    f.context.AmbientMode.setMinutes(1);
    f.advance(30000);
    f.dispatch('gamepadinputchanged', {detail: {changes: [{type: 'axis', index: 0, value: 0.8}], padIndex: 0}});
    f.advance(30000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), false, 'a real stick movement resets the timer');
    f.advance(30000);
    assert.strictEqual(f.context.AmbientMode.isDimmed(), true);
  }
  console.log('ambient_mode_test: menu-only timer, dim/wake, dialog, settings, noisy input and lifecycle PASS');
})();

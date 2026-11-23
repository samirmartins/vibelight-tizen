'use strict';
// Production navigation.js in a VM with fake elements that record focus and clicks. Not a browser.
const fs = require('fs'), vm = require('vm');
function load(extra = {}) {
  const elements = new Map(), log = [], timers = [];
  function el(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      const e = {id, nodeType: 1, disabled: false, value: '', checked: false, readOnly: false,
        classList: {add(n) { classes.add(n); }, remove(n) { classes.delete(n); }, contains(n) { return classes.has(n); }},
        dispatchEvent() {}, getAttribute() { return null; }, querySelector() { return null; }, closest() { return null; },
        focus() { log.push('focus:' + id); c.document.activeElement = e; },
        blur() { if (c.document.activeElement === e) c.document.activeElement = null; },
        click() { log.push('click:' + id); }};
      elements.set(id, e);
    }
    return elements.get(id);
  }
  const c = Object.assign({console: {log() {}, warn() {}, error() {}}, Array, Object, Math, Number, String, parseInt, parseFloat,
    Event: class {}, MouseEvent: class {},
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    document: {getElementById: el, activeElement: null, querySelectorAll() { return []; }, querySelector() { return null; }},
    addEventListener() {}, removeEventListener() {},
    LibraryNavigation: undefined, MenuI18n: undefined, ConsoleLibrary: undefined}, extra);
  c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/navigation.js', 'utf8') + '\nglobalThis.Views = Views; globalThis.Navigation = Navigation;', c);
  return {c, el, log, timers, views: c.Views};
}
module.exports = {load};

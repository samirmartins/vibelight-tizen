'use strict';
// Settings popup option lists must not depend on Material's generated wrapper
// depth. Synthetic DOM only; no TV or browser runtime.
const assert = require('assert'), fs = require('fs'), vm = require('vm');

function item(id) {
  return {id, classList: {add() {}, remove() {}, contains() { return false; }}};
}
function fixture() {
  const items = {};
  const wrappers = {};
  const options = {};
  const c = {
    console: {log() {}, warn() {}, error() {}},
    Array, Object, Math, Number, String, setTimeout() { return 1; }, clearTimeout() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    document: {
      getElementById(id) { return wrappers[id] || null; },
      querySelectorAll() { return []; }
    },
    window: {addEventListener() {}, removeEventListener() {}},
    LibraryNavigation: undefined, MenuI18n: undefined, ConsoleLibrary: undefined,
    addEventListener() {}, removeEventListener() {}
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/navigation.js', 'utf8') + '\nglobalThis.Views = Views; globalThis.Navigation = Navigation;', c);
  function add(id, count) {
    const option = {querySelector(selector) {
      return selector === '.mdl-menu' ? {children: items[id]} : null;
    }};
    const wrapper = {id, closest(selector) { return selector === '.setting-option' ? option : null; }};
    wrappers[id] = wrapper;
    options[id] = option;
    items[id] = Array.from({length: count}, (_, index) => item(id + '-' + index));
  }
  return {c, add, items, wrappers};
}

{
  const f = fixture();
  const menus = [
    ['videoResolutionMenu', 5, 'SelectResolutionMenu'],
    ['videoFramerateMenu', 2, 'SelectFramerateMenu'],
    ['videoBitrateMenu', 3, 'SelectBitrateMenu'],
    ['audioJitterMenu', 3, 'SelectAudioJitterMenu'],
    ['audioConfigMenu', 3, 'SelectAudioMenu'],
    ['videoCodecMenu', 3, 'SelectCodecMenu']
  ];
  for (const [id, count] of menus) f.add(id, count);
  for (const [id, count, viewName] of menus) {
    const view = f.c.Views[viewName];
    assert(view, viewName);
    const list = view.view.func();
    assert.strictEqual(list.length, count, viewName + ' option count');
    assert.strictEqual(list[0], f.items[id][0], viewName + ' first option');
    assert.strictEqual(view.view.current(), f.items[id][0]);
    view.view.next();
    assert.strictEqual(view.view.current(), f.items[id][1], viewName + ' next');
    view.view.prev();
    assert.strictEqual(view.view.current(), f.items[id][0], viewName + ' previous');
  }
  // A wrapper without a menu is inert rather than throwing through children[3].
  f.wrappers.videoResolutionMenu.closest = () => null;
  assert.strictEqual(f.c.Views.SelectResolutionMenu.view.func().length, 0);
  {
    const lifecycle = fixture();
    let soundsRunning = null;
    lifecycle.c.InterfaceSounds = {start() { soundsRunning = lifecycle.c.Navigation.isRunning(); }, stop() {}};
    lifecycle.c.Navigation.start();
    assert.strictEqual(soundsRunning, true, 'sound lifecycle starts after Navigation.isRunning');
    lifecycle.c.Navigation.stop();
  }
  console.log('navigation_menu_test: six settings menus resolve through menuItems, next/previous, lifecycle order and inert fallback PASS');
}

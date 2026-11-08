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
  const timers = [];
  const c = {
    console: {log() {}, warn() {}, error() {}},
    Array, Object, Math, Number, String, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
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
  return {c, add, items, wrappers, timers};
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
  // D-pad traversal must follow the rendered rows, including both wrap points.
  const html = fs.readFileSync('wasm/index.html', 'utf8');
  const sections = html.split(/<div id="([^"]+)" class="settings-options">/);
  const categories = {basicSettings:'BasicSettings', audioSettings:'AudioSettings',
    inputSettings:'InputSettings', hostSettings:'HostSettings',
    advancedSettings:'AdvancedSettings', aboutSettings:'AboutSettings'};
  let checked = 0;
  for (let i = 1; i < sections.length; i += 2) {
    const name = categories[sections[i]];
    assert(name, 'known settings category');
    const body = sections[i + 1].split('<section id="console-panel"')[0];
    const visual = [...body.matchAll(/<(?:button|label)\b[^>]*\bid="([^"]+)"/g)].map(match => match[1]);
    const view = f.c.Views[name];
    assert.deepStrictEqual(Array.from(view.view.func()), visual, name + ' follows visible row order');
    view.view.index = 0;
    for (let step = 1; step <= visual.length; step++) {
      view.down();
      assert.strictEqual(view.view.current(), visual[step % visual.length], name + ' D-pad down');
    }
    for (let step = 1; step <= visual.length; step++) {
      view.up();
      assert.strictEqual(view.view.current(), visual[(visual.length - step) % visual.length], name + ' D-pad up');
    }
    checked++;
  }
  assert.strictEqual(checked, 6, 'all settings categories checked');
  {
    const late=fixture();let focus=0;
    late.c.focusElement=()=>focus++;
    late.c.Navigation.push(late.c.Views.HostSettings);
    late.c.Navigation.push(late.c.Views.DeleteHostDialog);
    late.c.Navigation.pop();
    late.timers.splice(0).forEach(fn=>fn());
    assert.strictEqual(focus,0,'closed dialog timers cannot blur the current opener before focusing hidden controls');
  }
  console.log('navigation_menu_test: popup lists, lifecycle and D-pad row order/wrap in all six settings categories PASS');
}

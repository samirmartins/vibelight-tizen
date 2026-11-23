'use strict';
// With a pointer (Magic Remote or mouse) the bar must follow the control that was really focused:
// the next arrow starts from it, OK presses it, and the remote's view matches where the focus is.
const assert = require('assert');
const {fixture} = require('./fixtures/console-library.cjs');

const BOXES = {
  libraryPCsBtn: [0, 0, 100, 40], languageBtn: [110, 0, 100, 40], settingsBtn: [220, 0, 100, 40],
  libraryWake: [800, 100, 100, 40], libraryPlay: [910, 100, 100, 40], libraryFavorite: [1020, 100, 100, 40], libraryProfile: [1130, 100, 100, 40],
  libraryAll: [0, 200, 100, 40], libraryFavorites: [110, 200, 100, 40], libraryRecent: [220, 200, 100, 40], libraryRefresh: [1100, 200, 100, 40]
};
const rect = ([left, top, width, height]) => ({left, top, width, height, right: left + width, bottom: top + height});

async function setup(options = {}) {
  const f = fixture(4);
  const focused = [], changes = [], clicks = [], listeners = {};
  let view = 'grid';
  f.c.Views.Apps = {name: 'grid'}; f.c.Views.AppsNav = {name: 'nav'};
  f.c.Navigation.change = target => { view = target.name; changes.push(target.name); };
  f.c.Navigation.isCurrent = target => target.name === view;
  // The browser fires focusin whenever something takes the focus, by pointer or by code.
  const fire = target => { for (const fn of listeners.focusin || []) fn({target}); };
  f.c.document.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  f.c.focusElement = target => {
    const node = typeof target === 'string' ? f.node(target) : target;
    focused.push(node.id || 'card-' + node.dataset.appId);
    if (options.browserFires !== false) fire(node);
  };
  for (const [name, box] of Object.entries(BOXES)) {
    const node = f.node(name);
    node.getBoundingClientRect = () => rect(box);
  }
  await f.open();
  // The library installs its own handlers when it opens; spy on the presses afterwards.
  for (const name of Object.keys(BOXES)) f.node(name).onclick = () => clicks.push(name);
  focused.length = 0; changes.length = 0;
  f.node('quitRunningAppBtn').style.display = 'none';
  return {f, lib: f.c.ConsoleLibrary, focused, changes, clicks, fire, view: () => view, setView: value => { view = value; },
    card: () => f.node('game-grid').children[0]};
}

(async () => {
  // A pointer click on a bar control: the bar follows it and the remote's view becomes the bar.
  {
    const t = await setup();
    t.fire(t.f.node('libraryRecent'));
    assert.strictEqual(t.view(), 'nav', 'arrows now act on the bar');
    assert.deepStrictEqual(t.changes, ['nav']);
    t.focused.length = 0;
    t.lib.navMove('up');
    assert.strictEqual(t.focused[t.focused.length - 1], 'libraryWake', 'up starts from Recent, the control that was clicked');
  }
  // OK presses the control that has the focus, not the one the arrows left earlier.
  {
    const t = await setup();
    t.lib.focusNav(0, 'libraryPlay');
    t.fire(t.f.node('libraryFavorites'));
    t.clicks.length = 0;
    t.lib.acceptNav();
    assert.deepStrictEqual(t.clicks, ['libraryFavorites']);
  }
  // Already on the bar: following the focus changes nothing else and never loops.
  {
    const t = await setup();
    t.lib.focusNav(0, 'libraryAll');
    t.changes.length = 0;
    t.fire(t.f.node('libraryAll')); t.fire(t.f.node('libraryAll'));
    assert.deepStrictEqual(t.changes, [], 'the bar was already current');
  }
  // A pointer click on a game card puts the remote back on the grid.
  {
    const t = await setup();
    t.lib.focusNav(0, 'libraryAll');
    t.setView('nav'); t.changes.length = 0;
    t.fire(t.card());
    assert.deepStrictEqual(t.changes, ['grid']);
  }
  // Not for things that are not library controls or when the library is not in use.
  {
    const t = await setup();
    t.fire(t.f.node('somethingElse'));
    t.fire(t.f.node('cancelButtonOfADialog'));
    assert.deepStrictEqual(t.changes, []);
    t.f.c.isDialogOpen = true;
    t.fire(t.f.node('libraryRecent'));
    t.f.c.isDialogOpen = false;
    t.f.c.isInGame = true;
    t.fire(t.f.node('libraryRecent'));
    t.f.c.isInGame = false;
    assert.deepStrictEqual(t.changes, [], 'ignored under a dialog or during a stream');
    t.f.node('libraryRecent').disabled = true;
    t.fire(t.f.node('libraryRecent'));
    assert.deepStrictEqual(t.changes, [], 'a disabled control is not a stop');
  }
  // The remote's own moves still work when the browser reports every focus change.
  {
    const t = await setup();
    t.lib.focusNav(0, 'libraryPCsBtn');
    t.lib.navMove('down');
    assert.strictEqual(t.focused[t.focused.length - 1], 'libraryWake');
    t.lib.navMove('down');
    assert.strictEqual(t.focused[t.focused.length - 1], 'libraryRefresh');
    t.lib.navMove('left'); t.lib.navMove('left');
    assert.strictEqual(t.focused[t.focused.length - 1], 'libraryFavorites');
    assert(t.changes.length <= 1, 'no view ping-pong: ' + t.changes.join(','));
  }
  // Without the listener API or a view check the library still starts and works.
  {
    const f = fixture(4);
    delete f.c.document.addEventListener;
    await f.open();
    assert.doesNotThrow(() => f.c.ConsoleLibrary.focusNav(0, 'libraryAll'));
  }
  console.log('library_pointer_test: a pointer click moves the bar and the remote view, OK presses the focused control, no loops PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

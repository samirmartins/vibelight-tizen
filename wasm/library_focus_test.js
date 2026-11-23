'use strict';
// Remote-control navigation of the library follows the screen: up and down go to the row above or
// below, left and right stay in the row, and from the grid up reaches the nearest filter. Only
// behavior; the fixture gives each control a position like the real layout.
const assert = require('assert'), fs = require('fs');
const {fixture} = require('./fixtures/console-library.cjs');

const BOXES = {   // [left, top, width, height]
  libraryPCsBtn: [0, 0, 100, 40], languageBtn: [110, 0, 100, 40], settingsBtn: [220, 0, 100, 40], quitRunningAppBtn: [330, 0, 100, 40],
  libraryWake: [800, 100, 100, 40], libraryPlay: [910, 100, 100, 40], libraryFavorite: [1020, 100, 100, 40], libraryProfile: [1130, 100, 100, 40],
  libraryAll: [0, 200, 100, 40], libraryFavorites: [110, 200, 100, 40], libraryRecent: [220, 200, 100, 40], librarySearch: [330, 200, 100, 40], libraryRefresh: [1100, 200, 100, 40]
};
const rect = ([left, top, width, height]) => ({left, top, width, height, right: left + width, bottom: top + height});

async function setup(options = {}) {
  const f = fixture(options.count || 6);
  f.host.currentGame = options.running === false ? 0 : 2;   // a running game shows the quit button, like the real header
  const focused = [], changes = [];
  f.c.focusElement = target => focused.push(typeof target === 'string' ? target : target.id || ('card-' + target.dataset.appId));
  f.c.Navigation.change = view => changes.push(view === f.c.Views.Apps ? 'grid' : 'nav');
  if (!options.noGeometry) {
    for (const [name, box] of Object.entries(BOXES)) f.node(name).getBoundingClientRect = () => rect(box);
  } else {
    for (const name of Object.keys(BOXES)) f.node(name).getBoundingClientRect = () => rect([0, 0, 0, 0]);
  }
  await f.open();
  const cards = f.node('game-grid').children;
  cards.forEach((card, i) => { card.getBoundingClientRect = () => rect([(i % 2) * 300, 300 + Math.floor(i / 2) * 300, 280, 280]); });
  const lib = f.c.ConsoleLibrary;
  let current = '';   // where the focus is: the last focus event, or the start when nothing moved
  const at = name => { lib.focusNav(0, name); current = name; focused.length = 0; changes.length = 0; };
  const last = () => { if (focused.length) current = focused[focused.length - 1]; return current; };
  return {f, lib, at, last, focused, changes, cards};
}

(async () => {
  // Down goes to the nearest control of the row below; from the last row it goes to the grid.
  {
    const t = await setup();
    t.at('libraryPCsBtn'); t.lib.navMove('down'); assert.strictEqual(t.last(), 'libraryWake', 'header to the actions row');
    t.at('languageBtn'); t.lib.navMove('down'); assert.strictEqual(t.last(), 'libraryWake');
    t.at('libraryWake'); t.lib.navMove('down'); assert.strictEqual(t.last(), 'libraryRefresh', 'actions to the filters row, nearest on the screen');
    t.at('libraryProfile'); t.lib.navMove('down'); assert.strictEqual(t.last(), 'libraryRefresh');
    t.at('libraryFavorites'); t.lib.navMove('down'); assert.deepStrictEqual(t.changes, ['grid'], 'filters to the grid');
    t.at('libraryRefresh'); t.lib.navMove('down'); assert.deepStrictEqual(t.changes, ['grid']);
  }

  // Up goes to the nearest control of the row above and stops at the header.
  {
    const t = await setup();
    t.at('libraryFavorites'); t.lib.navMove('up'); assert.strictEqual(t.last(), 'libraryWake', 'filters to the actions row');
    t.lib.navMove('up'); assert.strictEqual(t.last(), 'quitRunningAppBtn', 'actions to the header, nearest on the screen');
    t.focused.length = 0; t.lib.navMove('up'); assert.deepStrictEqual(t.focused, [], 'the header is the top: nothing above, the focus stays');
    t.at('libraryAll'); t.lib.navMove('up'); assert.strictEqual(t.last(), 'libraryWake');
  }

  // Left and right stay inside their row, with no jump to the next or previous row.
  {
    const t = await setup();
    t.at('libraryRecent'); t.lib.navMove('right'); assert.strictEqual(t.last(), 'librarySearch');
    t.lib.navMove('right'); assert.strictEqual(t.last(), 'libraryRefresh');
    t.lib.navMove('right'); assert.strictEqual(t.last(), 'libraryRefresh', 'the row ends here');
    t.lib.navMove('left'); assert.strictEqual(t.last(), 'librarySearch');
    t.lib.navMove('left'); assert.strictEqual(t.last(), 'libraryRecent');
    t.at('libraryAll'); t.lib.navMove('left'); assert.strictEqual(t.last(), 'libraryAll', 'the row starts here');
    t.at('quitRunningAppBtn'); t.lib.navMove('right'); assert.strictEqual(t.last(), 'quitRunningAppBtn', 'not Wake PC, which is another row');
    t.at('libraryWake'); t.lib.navMove('left'); assert.strictEqual(t.last(), 'libraryWake', 'not the header');
    t.lib.navMove('right'); assert.strictEqual(t.last(), 'libraryPlay');
    t.lib.navMove('right'); t.lib.navMove('right'); assert.strictEqual(t.last(), 'libraryProfile');
    t.lib.navMove('right'); assert.strictEqual(t.last(), 'libraryProfile');
  }

  // Without a running game the quit button is not shown, and the header ends at Settings.
  {
    const t = await setup({running: false});
    t.at('libraryWake'); t.lib.navMove('up'); assert.strictEqual(t.last(), 'settingsBtn');
    t.at('settingsBtn'); t.lib.navMove('right'); assert.strictEqual(t.last(), 'settingsBtn');
  }

  // Hidden or disabled controls are not stops; a row with none is skipped.
  {
    const t = await setup();
    t.f.node('libraryWake').disabled = true;
    t.at('libraryPCsBtn'); t.lib.navMove('down'); assert.strictEqual(t.last(), 'libraryPlay', 'Wake PC is disabled');
    for (const name of ['libraryWake', 'libraryPlay', 'libraryFavorite', 'libraryProfile']) t.f.node(name).style.display = 'none';
    t.at('libraryPCsBtn'); t.lib.navMove('down'); assert.strictEqual(t.last(), 'libraryAll', 'the empty actions row is skipped');
  }

  // From the first row of the grid, up reaches the filter nearest to that card, not a far button.
  {
    const t = await setup({running: false});
    t.f.c.ConsoleLibrary.focusCards();
    t.lib.move(0, -1);
    assert.strictEqual(t.last(), 'libraryFavorites', 'card in the left column: nearest filter');
    const second = await setup({running: false});
    second.lib.move(1, 0);
    second.focused.length = 0;
    second.lib.move(0, -1);
    assert.strictEqual(second.last(), 'librarySearch', 'card in the right column: nearest control of the filter row (Search sits after Recent)');
    // Down from the filters comes back to the selected card.
    second.lib.navMove('down');
    assert.deepStrictEqual(second.changes.slice(-1), ['grid']);
  }

  // Without screen positions (nothing measurable) the old linear order still works.
  {
    const t = await setup({noGeometry: true});
    t.at('libraryRecent');
    t.lib.navMove('up'); assert.strictEqual(t.last(), 'libraryFavorites', 'previous control');
    t.lib.navMove('right'); assert.strictEqual(t.last(), 'libraryRecent');
    t.lib.navMove('left'); assert.strictEqual(t.last(), 'libraryFavorites');
    t.lib.navMove('down'); assert.deepStrictEqual(t.changes.slice(-1), ['grid']);
    t.focused.length = 0;
    t.lib.move(0, -1);
    assert.strictEqual(t.last(), 'libraryPlay', 'the old target from the grid');
  }

  // The remote's directions reach these actions (navigation.js is the only place that maps them).
  {
    const nav = fs.readFileSync('wasm/platform/navigation.js', 'utf8');
    const block = nav.slice(nav.indexOf('  AppsNav: {'), nav.indexOf('  QuitAppDialog: {'));
    for (const direction of ['up', 'down', 'left', 'right']) {
      assert(block.includes(`${direction}: function() { ConsoleLibrary.navMove('${direction}'); }`), 'AppsNav.' + direction);
    }
    assert(block.includes('accept: function() { ConsoleLibrary.acceptNav(); }'), 'OK still presses the focused control');
    assert(block.includes('back: function() { ConsoleLibrary.backAction(); }'), 'Back unchanged');
    assert(block.includes('press: function() { ConsoleLibrary.favorite(); }'), 'channel up unchanged');
  }
  console.log('library_focus_test: rows follow the screen, left/right stay in the row, grid up reaches the nearest filter, linear fallback PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

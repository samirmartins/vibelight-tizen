'use strict';
// Library search: a Search button on the filter row opens a field; the grid filters on every letter,
// within the current filter, ignoring case and accents; Clear and Back clear and close it; it is not
// remembered after leaving the library. Real library code in the library fixture.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const {fixture} = require('./fixtures/console-library.cjs');
const TITLES = ['The Legend of Zelda', 'Mario Kart', 'Zeldaris', 'Último Jogo'];
const ALL = [2, 1, 4, 3]; // the grid is sorted by title

async function setup() {
  const f = fixture(4), c = f.c;
  f.apps.forEach((app, i) => { app.title = TITLES[i]; });
  vm.runInContext(fs.readFileSync('wasm/platform/library-search.js', 'utf8'), c);
  f.exits = 0; c.exitAppDialog = () => { f.exits++; };
  await f.open();
  return f;
}
const ids = f => Array.from(f.node('game-grid').children).map(card => Number(card.dataset.appId));
function type(f, text) { const input = f.node('librarySearchInput'); input.value = text; input.oninput(); }
const hovered = (f, name) => f.node(name).classList.contains('hovered');

(async () => {
  let f = await setup();
  assert.deepStrictEqual(ids(f), ALL);
  // The button is on the filter row, reachable with the remote; the field starts closed.
  f.c.ConsoleLibrary.focusNav(0, 'librarySearch'); assert(hovered(f, 'librarySearch'), 'Search is a library control');
  assert.strictEqual(f.node('librarySearchBar').hidden, true);
  f.c.ConsoleLibrary.focusNav(0, 'librarySearchInput'); assert(!hovered(f, 'librarySearchInput'), 'the field is not a control while closed');

  // Opening: the field and Clear appear and join the remote order; the field is ready to type.
  f.node('librarySearch').click();
  assert.strictEqual(f.node('librarySearchBar').hidden, false);
  assert.strictEqual(f.node('librarySearchInput').hidden, false); assert.strictEqual(f.node('librarySearchClear').hidden, false);
  assert.strictEqual(f.node('librarySearchInput').readOnly, false, 'ready to type');
  f.c.ConsoleLibrary.focusNav(0, 'librarySearchClear'); assert(hovered(f, 'librarySearchClear'), 'Clear is a control while open');

  // Each letter filters; case and accents are ignored; the first match is selected.
  type(f, 'z'); assert.deepStrictEqual(ids(f), [1, 3]);
  type(f, 'zel'); assert.deepStrictEqual(ids(f), [1, 3]);
  type(f, 'ZELDA'); assert.deepStrictEqual(ids(f), [1, 3]);
  assert.strictEqual(f.node('libraryTitle').textContent, 'The Legend of Zelda');
  type(f, 'zeldar'); assert.deepStrictEqual(ids(f), [3]);
  assert.strictEqual(f.node('libraryTitle').textContent, 'Zeldaris');
  type(f, 'ultimo'); assert.deepStrictEqual(ids(f), [4]);
  type(f, 'ÚLTIMO'); assert.deepStrictEqual(ids(f), [4]);
  type(f, ''); assert.deepStrictEqual(ids(f), ALL);
  assert.strictEqual(f.node('libraryEmpty').hidden, true);

  // No match: the list is empty with a message, Play has no game; clearing the text brings it all back.
  type(f, 'xyz'); assert.deepStrictEqual(ids(f), []);
  assert.strictEqual(f.node('libraryEmpty').hidden, false); assert.strictEqual(f.node('libraryEmpty').textContent, 'No games found.');
  assert.strictEqual(f.node('libraryPlay').disabled, true);
  type(f, 'mario'); assert.deepStrictEqual(ids(f), [2]); assert.strictEqual(f.node('libraryEmpty').hidden, true);

  // The search works inside the current filter.
  f = await setup();
  f.c.localStorage.getItem('x'); // fixture storage is live
  f.node('libraryFavorites').click(); // nothing is a favorite yet
  assert.deepStrictEqual(ids(f), []);
  f.node('libraryAll').click(); f.card(1).onfocus(); f.c.ConsoleLibrary.favorite(); // favorite game 1
  f.node('libraryFavorites').click(); assert.deepStrictEqual(ids(f), [1]);
  f.node('librarySearch').click();
  type(f, 'zel'); assert.deepStrictEqual(ids(f), [1], 'favorites ∩ search');
  type(f, 'mario'); assert.deepStrictEqual(ids(f), [], 'a game outside the filter is not found');
  f.node('libraryAll').click(); assert.deepStrictEqual(ids(f), [2], 'the text stays when the filter changes');
  type(f, 'zel'); f.node('libraryFavorites').click(); assert.deepStrictEqual(ids(f), [1]);

  // Clear clears and closes; the focus goes back to the Search button.
  f = await setup(); f.node('librarySearch').click(); type(f, 'zel'); assert.deepStrictEqual(ids(f), [1, 3]);
  f.node('librarySearchClear').click();
  assert.strictEqual(f.node('librarySearchInput').value, ''); assert.strictEqual(f.node('librarySearchBar').hidden, true);
  assert.deepStrictEqual(ids(f), ALL); assert(hovered(f, 'librarySearch'), 'focus returns to Search');

  // Back clears and closes first; with the field closed Back is what it was (the exit question).
  f = await setup(); f.node('librarySearch').click(); type(f, 'zel');
  f.c.ConsoleLibrary.backAction();
  assert.strictEqual(f.exits, 0, 'the first Back only closes the search');
  assert.strictEqual(f.node('librarySearchBar').hidden, true); assert.deepStrictEqual(ids(f), ALL);
  f.c.ConsoleLibrary.backAction(); assert.strictEqual(f.exits, 1, 'Back with no search is unchanged');

  // Searching again starts empty; leaving the library and coming back forgets the search.
  f = await setup(); f.node('librarySearch').click(); type(f, 'zel');
  await f.c.ConsoleLibrary.open(f.host); await f.flush();
  assert.strictEqual(f.node('librarySearchBar').hidden, true); assert.strictEqual(f.node('librarySearchInput').value, '');
  assert.deepStrictEqual(ids(f), ALL, 'a new visit shows every game');

  // Typing keeps Left/Right for the cursor; with the field not being edited they move along the row.
  f = await setup(); f.node('librarySearch').click();
  f.c.ConsoleLibrary.focusNav(0, 'librarySearchInput');
  f.c.document.activeElement = f.node('librarySearchInput'); f.node('librarySearchInput').readOnly = false;
  f.c.ConsoleLibrary.navMove('left'); f.c.ConsoleLibrary.navMove('right');
  assert(hovered(f, 'librarySearchInput'), 'Left/Right stay in the text while typing');
  f.node('librarySearchInput').onblur(); assert.strictEqual(f.node('librarySearchInput').readOnly, true, 'stops editing when it loses focus');
  f.c.document.activeElement = null;
  f.c.ConsoleLibrary.navMove('right'); assert(!hovered(f, 'librarySearchInput'), 'arrows move on when not typing');
  // OK (or a click) on the field starts typing again.
  f.node('librarySearchInput').onclick(); assert.strictEqual(f.node('librarySearchInput').readOnly, false);

  console.log('library_search_test: Search opens the field, filters on every letter inside the filter, Clear and Back close it PASS');
})().catch(error => { console.error(error); process.exit(1); });

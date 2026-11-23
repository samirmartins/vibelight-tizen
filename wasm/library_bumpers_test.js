'use strict';
// R1/L1 in the library walk the filter row: All games → Favorites → Recent → Search → back to All games.
// Landing on Search only moves the focus there (OK opens it); the filter in use does not change.
// Production library-navigation.js with stubbed menu objects and a controlled clock.
const assert = require('assert'), fs = require('fs'), vm = require('vm');

function fixture() {
  const log = [], pressed = {libraryAll: 'true', libraryFavorites: 'false', libraryRecent: 'false'};
  let now = 1000, active = null;
  const node = name => ({id: name,
    getAttribute(attr) { return attr === 'aria-pressed' && name in pressed ? pressed[name] : null; },
    click() { log.push('click:' + name); if (name in pressed) for (const key of Object.keys(pressed)) pressed[key] = String(key === name); }});
  const nodes = {};
  ['libraryAll', 'libraryFavorites', 'libraryRecent', 'librarySearch'].forEach(name => { nodes[name] = node(name); });
  const c = {console, Date: {now: () => now}, Math, Number, Object, isDialogOpen: false, isInGame: false,
    document: {hidden: false, getElementById: id => nodes[id] || null, get activeElement() { return active; }},
    Navigation: {change() {}, isRunning: () => true}, Views: {Apps: {}},
    ConsoleLibrary: {visible: () => true, move() {}, focusNav(step, name) { log.push('focus:' + name); active = nodes[name]; }},
    setTimeout() { return 1; }, clearTimeout() {}};
  c.window = c; vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/library-navigation.js', 'utf8') + '\nglobalThis.LibraryNavigation = LibraryNavigation;', c);
  const press = index => {
    now += 100; c.LibraryNavigation.handle({padIndex: 0, changes: [{type: 'button', index, pressed: true}]});
    now += 100; c.LibraryNavigation.handle({padIndex: 0, changes: [{type: 'button', index, pressed: false}]});
  };
  return {c, log, press, r1: () => press(5), l1: () => press(4), pressed, nodes, setActive(id) { active = id ? nodes[id] : null; }};
}
const last = f => f.log[f.log.length - 1];

// R1 walks forward: Favorites, Recent, then Search (focus only), then back to All games.
let f = fixture();
f.r1(); assert.deepStrictEqual(f.log, ['click:libraryFavorites', 'focus:libraryFavorites']);
f.r1(); assert.strictEqual(f.pressed.libraryRecent, 'true');
f.log.length = 0; f.r1();
assert.deepStrictEqual(f.log, ['focus:librarySearch'], 'R1 from Recent only focuses Search, nothing is clicked');
assert.strictEqual(f.pressed.libraryRecent, 'true', 'the filter in use does not change');
f.log.length = 0; f.r1();
assert.deepStrictEqual(f.log, ['click:libraryAll', 'focus:libraryAll'], 'R1 from Search goes around to All games');
assert.strictEqual(f.pressed.libraryAll, 'true');

// L1 walks backward and also goes around: All games → Search → Recent → Favorites → All games.
f = fixture();
f.l1(); assert.deepStrictEqual(f.log, ['focus:librarySearch'], 'L1 from All games goes around to Search');
assert.strictEqual(f.pressed.libraryAll, 'true');
f.log.length = 0; f.l1();
assert.deepStrictEqual(f.log, ['click:libraryRecent', 'focus:libraryRecent'], 'L1 from Search goes to Recent');
f.log.length = 0; f.l1(); assert.strictEqual(f.pressed.libraryFavorites, 'true');
f.l1(); assert.strictEqual(f.pressed.libraryAll, 'true');

// Where the focus is wins over the filter in use: with the focus on Search, R1/L1 start from there.
f = fixture(); f.setActive('librarySearch');
f.r1(); assert.strictEqual(f.pressed.libraryAll, 'true'); assert.strictEqual(last(f), 'focus:libraryAll');
f = fixture(); f.setActive('librarySearch');
f.l1(); assert.strictEqual(f.pressed.libraryRecent, 'true');

// A full lap of R1 visits the four stops in order and never clicks Search.
f = fixture(); const visited = [];
for (let i = 0; i < 8; i++) { f.r1(); visited.push(last(f)); }
assert.deepStrictEqual(visited, ['focus:libraryFavorites', 'focus:libraryRecent', 'focus:librarySearch', 'focus:libraryAll',
  'focus:libraryFavorites', 'focus:libraryRecent', 'focus:librarySearch', 'focus:libraryAll']);
assert(!f.log.includes('click:librarySearch'), 'the bumpers never open the search');

// Still inert while a dialog is open.
f = fixture(); f.c.isDialogOpen = true; f.r1(); f.l1();
assert.deepStrictEqual(f.log, [], 'no filter or focus moves while a dialog is open');
console.log('library_bumpers_test: R1/L1 walk All games, Favorites, Recent and Search, around, Search by focus only PASS');

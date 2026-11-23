'use strict';
// Library search, rules only: a game matches when the typed text is part of its name, ignoring case
// and accents; an empty search matches everything. No DOM.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const context = vm.createContext({String, Array});
vm.runInContext(fs.readFileSync('wasm/platform/library-search.js', 'utf8'), context);
const api = context.LibrarySearch;

// Normalising: lower case, no accents, single spaces, trimmed.
assert.strictEqual(api.normalize('  The  Légend of ZELDA '), 'the legend of zelda');
assert.strictEqual(api.normalize('Pokémon'), 'pokemon');
assert.strictEqual(api.normalize('ÁÉÍÓÚ çñü'), 'aeiou cnu');
assert.strictEqual(api.normalize(''), '');
assert.strictEqual(api.normalize(undefined), '');
assert.strictEqual(api.normalize(null), '');
assert.strictEqual(api.normalize(42), '42');

// Matching: a part of the name, anywhere in it.
const cases = [
  ['The Legend of Zelda', 'zel', true], ['The Legend of Zelda', 'ZEL', true], ['The Legend of Zelda', 'legend', true],
  ['The Legend of Zelda', 'of zel', true], ['The Legend of Zelda', 'zelda ', true], ['The Legend of Zelda', 'mario', false],
  ['Pokémon Legends', 'pokemon', true], ['Pokemon Legends', 'pokémon', true], ['Pokémon Legends', 'legends arceus', false],
  ['Café Mania', 'cafe', true], ['Game 007', '7', true], ['Game 007', '008', false],
  ['Anything', '', true], ['Anything', '   ', true], ['Anything', undefined, true],
  ['', 'a', false], [undefined, 'a', false],
];
for (const [title, query, expected] of cases) assert.strictEqual(api.matches(title, query), expected, `${title} / ${query}`);

// Filtering a list keeps the order and the same objects.
const games = [{id: 1, title: 'Zelda'}, {id: 2, title: 'Mario Kart'}, {id: 3, title: 'Zeldaris'}, {id: 4, title: 'Último'}];
assert.deepStrictEqual(Array.from(api.filter(games, 'zel'), g => g.id), [1, 3]);
assert.deepStrictEqual(Array.from(api.filter(games, 'ultimo'), g => g.id), [4]);
assert.deepStrictEqual(Array.from(api.filter(games, ''), g => g.id), [1, 2, 3, 4]);
assert.deepStrictEqual(Array.from(api.filter(games, 'nada'), g => g.id), []);
assert.strictEqual(api.filter(games, 'zel')[0], games[0]);
assert.deepStrictEqual(Array.from(api.filter(null, 'a')), []);
console.log('library_search_rules_test: names match by part, ignoring case and accents PASS');

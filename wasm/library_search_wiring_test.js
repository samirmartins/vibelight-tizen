'use strict';
// The page carries what the library search needs: the module, every element the library reaches for, and
// the style, so a missing id cannot break the library.
const assert = require('assert'), fs = require('fs');
const html = fs.readFileSync('wasm/index.html', 'utf8'), library = fs.readFileSync('wasm/platform/console-library.js', 'utf8'),
  css = fs.readFileSync('wasm/static/css/console-library.css', 'utf8');
const tag = name => `<script type="text/javascript" src="platform/${name}.js"></script>`;
assert.strictEqual(html.split(tag('library-search')).length - 1, 1, 'index.html loads library-search once');
assert(html.indexOf(tag('library-search')) < html.indexOf(tag('console-library')), 'loaded before the library');

for (const id of ['librarySearch', 'librarySearchBar', 'librarySearchInput', 'librarySearchClear']) {
  assert(library.includes("'" + id + "'"), 'the library uses ' + id);
  assert.strictEqual(html.split(`id="${id}"`).length - 1, 1, `index.html has ${id} once`);
}
const filters = html.slice(html.indexOf('<div class="console-filters"'), html.indexOf('<p id="libraryEmpty"'));
assert(filters.indexOf('id="libraryRecent"') < filters.indexOf('id="librarySearch"') && filters.indexOf('id="librarySearch"') < filters.indexOf('id="libraryRefresh"'),
  'Search sits on the filter row, after Recent');
assert(/<button type="button" id="librarySearch" class="console-button">Search<\/button>/.test(filters));
assert(filters.indexOf('id="librarySearchBar"') > filters.indexOf('id="libraryRefresh"'), 'the field opens below the filter row');
assert(/<div id="librarySearchBar" class="console-search" hidden>/.test(filters), 'closed by default');
assert(/<input id="librarySearchInput" type="text" class="console-search-input" readonly hidden maxlength="64"/.test(filters), 'a read-only, hidden text field until typing');
assert(/<button type="button" id="librarySearchClear" class="console-button" hidden>Clear<\/button>/.test(filters));
assert(/\.console-search\s*\{[^}]*display:\s*flex/.test(css) && /\.console-search\[hidden\][^{]*\{\s*display:\s*none/.test(css), 'hidden means hidden');
assert(/\.console-search-input:focus[^{]*\{[^}]*outline/.test(css), 'visible focus for the remote');
console.log('library_search_wiring_test: module, elements and style are on the page PASS');

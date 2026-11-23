'use strict';
// The page carries what the wake-and-play flow needs: the module, and every element the library
// reaches for, so a missing id cannot break Play on a PC that is off.
const assert = require('assert'), fs = require('fs');
const html = fs.readFileSync('wasm/index.html', 'utf8'), library = fs.readFileSync('wasm/platform/console-library.js', 'utf8');

const tag = name => `<script type="text/javascript" src="platform/${name}.js"></script>`;
assert.strictEqual(html.split(tag('wake-and-play')).length - 1, 1, 'index.html loads wake-and-play once');
assert(html.indexOf(tag('wake-and-play')) < html.indexOf(tag('console-library')), 'loaded before the library');

const used = new Set([...library.matchAll(/el\('(wakePlay\w+)'\)/g)].map(m => m[1]));
for (const id of ['wakePlayTitle', 'wakePlayStatus', 'wakePlayNote', 'wakePlayElapsed', 'wakePlayWake', 'wakePlayTry', 'wakePlayRemember', 'wakePlayRememberRow', 'wakePlayCancel']) {
  assert(used.has(id), 'the library uses ' + id);
}
for (const id of [...used, 'wakePlayDialog', 'wakePlayDialogOverlay']) {
  assert.strictEqual(html.split(`id="${id}"`).length - 1, 1, `index.html has ${id} once`);
}
const dialog = html.slice(html.indexOf('id="wakePlayDialog"'));
assert(/^id="wakePlayDialog" class="mdl-dialog utility-dialog"/.test(dialog), 'same look and navigation as the other utility dialogs');
for (const id of ['wakePlayWake', 'wakePlayTry', 'wakePlayCancel']) {
  assert(new RegExp(`<button id="${id}" type="button" class="mdl-button mdl-js-button mdl-button--raised">`).test(html), id + ' is a button');
}
assert(/<p id="wakePlayStatus" role="status">/.test(html), 'the waiting text is announced as status');
// "Remember my choice" is a checkbox in its own row below the buttons, aligned right.
const actions = html.indexOf('<div class="utility-actions">', html.indexOf('id="wakePlayDialog"'));
const row = html.indexOf('id="wakePlayRememberRow"', actions);
assert(row > actions && row < html.indexOf('</dialog>', actions), 'the row follows the buttons');
assert(/<div id="wakePlayRememberRow" class="wake-remember">\s*<label><input id="wakePlayRemember" type="checkbox"> <span>Remember my choice<\/span><\/label>\s*<\/div>/.test(html), 'a labelled checkbox');
const css = fs.readFileSync('wasm/static/css/menu-tools.css', 'utf8');
assert(/\.wake-remember\s*\{[^}]*text-align:\s*right/.test(css), 'aligned right');
assert(/\.wake-remember input:focus \+ span\s*\{[^}]*outline/.test(css), 'visible focus for the remote');
console.log('wake_and_play_wiring_test: OK');

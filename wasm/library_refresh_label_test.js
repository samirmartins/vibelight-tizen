'use strict';
// The library refresh button says what it does: it checks the PC and reloads the game list. The label is
// translated and the guide uses the same name in the three languages.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('wasm/index.html', 'utf8');
assert(/<button type="button" id="libraryRefresh" class="console-button">Refresh PC and library<\/button>/.test(html), 'the button label');
assert(!html.includes('>Refresh library<'), 'the old label is gone');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync('wasm/platform/menu-translations.js', 'utf8') + '\nglobalThis.rows = MenuTranslations;', context);
const row = Array.from(context.rows).find(r => r[0] === 'Refresh PC and library');
assert(row, 'a translation row'); assert.strictEqual(row[1], 'Atualizar PC e biblioteca'); assert.strictEqual(row[2], 'Actualizar PC y biblioteca');
assert(!Array.from(context.rows).some(r => r[0] === 'Refresh library'), 'no row for the old label');

for (const [locale, label] of [['en', 'Refresh PC and library'], ['pt-br', 'Atualizar PC e biblioteca'], ['es', 'Actualizar PC y biblioteca']]) {
  const guide = fs.readFileSync(`docs/_source/${locale}.json`, 'utf8');
  assert(guide.includes(label), `${locale}: the guide names the button ${label}`);
}
console.log('library_refresh_label_test: Refresh PC and library, translated and in the guide PASS');

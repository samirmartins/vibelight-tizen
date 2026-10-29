'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm'), cp = require('child_process');
const context = {};
vm.runInNewContext(fs.readFileSync('wasm/platform/menu-translations.js','utf8'), context);
const rows = JSON.parse(JSON.stringify(context.MenuTranslations));
assert(rows.length > 250);
assert.strictEqual(new Set(rows.map(row => row[0])).size, rows.length);
for (const row of rows) {
  assert.strictEqual(row.length,3);
  const placeholders = s => (s.match(/\{\d+\}/g)||[]).sort();
  for (const value of row) {
    assert(value.length);
    assert.deepStrictEqual(placeholders(value),placeholders(row[0]),row[0]);
    assert(!/[<>]/.test(value), 'catalog is text, never executable markup');
  }
}
const moduleSource = fs.readFileSync('wasm/platform/menu-i18n.js','utf8');
assert(!/setTimeout|setInterval|requestAnimationFrame|fetch\(|XMLHttpRequest|addEventListener\(['"](?:keydown|mousemove|gamepad)/.test(moduleSource));
assert(moduleSource.includes('observer.disconnect(); observer.takeRecords();'));
assert(moduleSource.includes('if (!running || codes.indexOf(value) === -1) return;'));
for (const [stored,language,expected] of [[null,'pt-BR','pt-BR'],[null,'es-ES','es'],[null,'de-DE','en'],['en','pt-BR','en'],['es','pt-BR','es'],['corrupt','pt-BR','pt-BR']]) {
  const sandbox={MenuTranslations:rows,navigator:{language},localStorage:{getItem(){return stored;}},document:{addEventListener(){}}};
  vm.runInNewContext(moduleSource,sandbox);
  assert.strictEqual(sandbox.MenuI18n.locale(),expected);
}
const failedStorage={MenuTranslations:rows,navigator:{language:'es'},localStorage:{getItem(){throw Error('denied');}},document:{addEventListener(){}}};
vm.runInNewContext(moduleSource,failedStorage);assert.strictEqual(failedStorage.MenuI18n.locale(),'es');
const normalization = require('./menu-i18n-scope.cjs').normalize;
for (const file of ['wasm/index.html','wasm/platform/navigation.js','wasm/platform/console-library.js','res/config.xml']) {
  const source=fs.readFileSync(file,'utf8');
  const stable=cp.execFileSync('git',['show','v3.4.15:'+file],{encoding:'utf8'});
  assert.strictEqual(normalization(file,source),stable,file+' only menu integration');
  assert.notStrictEqual(normalization(file,source+'\nthrow Error("unexpected");'),stable);
}
const frozen=['wasm/platform/index.js','wasm/platform/messages.js','wasm/platform/gamepad.js','wasm/platform/audio.js','wasm/platform/audio-worklet.js','wasm/platform/display.js','wasm/platform/diagnostics.js','wasm/platform/controller-mapping.js','wasm/main.cpp','wasm/wasmplayer.cpp','wasm/gamepad.cpp','wasm/auddec.cpp'];
for (const file of frozen) assert(fs.readFileSync(file).equals(cp.execFileSync('git',['show','v3.4.15:'+file])),file+' remains identical');
console.log('menu_i18n_test: catalog integrity, text-only templates, exact menu-only integration and unchanged gameplay sources PASS');

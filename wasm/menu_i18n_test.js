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
const nativeStages = [...fs.readFileSync('moonlight-common-c/src/Connection.c','utf8').match(/stageNames\[STAGE_MAX\] = \{([\s\S]*?)\};/)[1].matchAll(/"([^"]+)"/g)].map(m => 'Starting '+m[1]+'...').sort();
const pairing = 'If your host PC is running VibeShine (recommended) or Sunshine (all GPUs), open the VibeShine or Sunshine web interface to enter the PIN.';
assert(fs.readFileSync('wasm/platform/index.js','utf8').includes(pairing), 'pairing copy names VibeShine');
assert(rows.some(row => row[0] === pairing), 'pairing copy has translations');
const moduleSource = fs.readFileSync('wasm/platform/menu-i18n.js','utf8');
assert(!/setTimeout|setInterval|requestAnimationFrame|fetch\(|XMLHttpRequest|addEventListener\(['"](?:keydown|mousemove|gamepad)/.test(moduleSource));
assert(moduleSource.includes('observer.disconnect(); observer.takeRecords();'));
assert(moduleSource.includes('ControllerIdentity.refreshPlayers()'));
assert(moduleSource.includes('if (!running || codes.indexOf(value) === -1) return;'));
for (const [stored,language,expected] of [[null,'pt-BR','pt-BR'],[null,'es-ES','es'],[null,'de-DE','en'],['en','pt-BR','en'],['es','pt-BR','es'],['corrupt','pt-BR','pt-BR']]) {
  const sandbox={MenuTranslations:rows,navigator:{language},localStorage:{getItem(){return stored;}},document:{addEventListener(){}}};
  vm.runInNewContext(moduleSource,sandbox);
  assert.strictEqual(sandbox.MenuI18n.locale(),expected);
  assert.deepStrictEqual(Object.keys(sandbox.MenuI18n.progressText).filter(s=>nativeStages.includes(s)).sort(),nativeStages);
  const progress=sandbox.MenuI18n.progressText['Starting RTSP handshake...'];
  assert.strictEqual(progress,expected==='pt-BR'?'Iniciando negociação RTSP...':expected==='es'?'Iniciando negociación RTSP...':'Starting RTSP handshake...');
}
{
  const numbering={MenuTranslations:rows,navigator:{language:'pt-BR'},localStorage:{getItem(){return null;}},document:{addEventListener(){}}};
  vm.runInNewContext(moduleSource,numbering);
  assert.strictEqual(numbering.MenuI18n.text('Controller 1'),'Controle 1');
  assert.strictEqual(numbering.MenuI18n.text('Controller 4'),'Controle 4');
  assert.strictEqual(numbering.MenuI18n.text('Hold Guide for 3 seconds to exit the test.'),'Segure Guide por 3 segundos para sair do teste.');
  assert.strictEqual(numbering.MenuI18n.text('Keep holding HOME: 2 s'),'Continue segurando HOME: 2 s');
  const spanish={MenuTranslations:rows,navigator:{language:'es'},localStorage:{getItem(){return null;}},document:{addEventListener(){}}};
  vm.runInNewContext(moduleSource,spanish);
  assert.strictEqual(spanish.MenuI18n.text('Controller 2'),'Mando 2');
}
const failedStorage={MenuTranslations:rows,navigator:{language:'es'},localStorage:{getItem(){throw Error('denied');}},document:{addEventListener(){}}};
vm.runInNewContext(moduleSource,failedStorage);assert.strictEqual(failedStorage.MenuI18n.locale(),'es');
console.log('menu_i18n_test: catalog integrity, text-only templates and locale fallback PASS');

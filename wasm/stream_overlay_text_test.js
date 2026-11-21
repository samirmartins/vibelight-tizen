'use strict';
// The Type text entry of the stream menu: a field that opens the TV keyboard, Send and
// Back, the messages for each refusal, and a field that never keeps typed text.
const assert = require('assert');
const {fixture} = require('./fixtures/stream-overlay.cjs');
const PTR = 256;
const ORDER = ['resume', 'volume', 'stats', 'shortcuts', 'text', 'disconnect', 'end'];

function opened(options = {}) {
  const f = fixture(options), blocks = [], heap = new ArrayBuffer(4096);
  f.c.Module.HEAP32 = {buffer: heap};
  f.c.Module._utf8TextBuffer = () => PTR;
  f.c.Module._sendUtf8Text = length => {
    if (options.failSend) return -1;
    blocks.push(Array.from(new Uint8Array(heap, PTR, length)));
    return 0;
  };
  f.setPad({});
  assert.strictEqual(f.c.StreamOverlay.open(), true);
  f.step();   // prime the pad
  const node = id => f.document.getElementById(id);
  const enter = () => { f.c.FocusManager.select(ORDER.indexOf('text')); f.press({0: true}); f.release(); };
  const typed = () => Buffer.from([].concat(...blocks)).toString('utf8');
  return {f, node, blocks, enter, typed};
}

// The menu lists Type text after Shortcuts.
{
  const {f, node} = opened();
  assert.strictEqual(f.text('streamOverlay-text-label'), 'Digitar texto', 'bundled pt-BR label');
  assert.strictEqual(f.text('streamOverlay-text-meta'), 'Digitado na TV, enviado ao PC');
  assert.deepStrictEqual(ORDER.map(id => !!node('streamOverlay-' + id)), ORDER.map(() => true));
}

// Opening shows an empty field with the right attributes; OK on it opens the TV keyboard.
{
  const t = opened();
  const {f, node} = t;
  t.enter();
  assert.strictEqual(node('streamOverlayActions').hidden, true);
  assert.strictEqual(node('streamOverlayText').hidden, false);
  const input = node('streamOverlayTextInput');
  assert.strictEqual(input.value, '');
  assert.strictEqual(input.getAttribute('maxlength'), '256');
  assert.strictEqual(input.getAttribute('autocomplete'), 'off');
  assert.strictEqual(input.getAttribute('spellcheck'), 'false');
  assert.strictEqual(input.getAttribute('type'), 'text');
  assert.strictEqual(f.text('streamOverlayTextTitle'), 'Digitar texto para o PC');
  assert.strictEqual(f.text('streamOverlayTextHint'), 'Aperte OK no campo para abrir o teclado.');
  assert.strictEqual(f.text('streamOverlayTextSend'), 'Enviar');
  assert.strictEqual(f.text('streamOverlayTextBack'), 'Voltar');
  assert.strictEqual(f.c.FocusManager.index(), 0);
  f.press({0: true}); f.release();
  assert(input.focused >= 1 && input.clicked === 1, 'OK focuses the field and clicks it to open the keyboard');
  assert.strictEqual(f.c.StreamOverlay.isOpen(), true);
  // Down/up move between the field, Send and Back.
  f.press({13: true}); f.release();
  assert.strictEqual(f.c.FocusManager.index(), 1);
  f.press({13: true}); f.release();
  assert.strictEqual(f.c.FocusManager.index(), 2);
  f.press({12: true}); f.release();
  assert.strictEqual(f.c.FocusManager.index(), 1);
}

// Send: the text goes to the PC in UTF-8, the field is cleared and the menu closes.
{
  const t = opened();
  const {f, node} = t;
  t.enter();
  node('streamOverlayTextInput').value = 'Olá, ação! 😀 ' + 'x'.repeat(40);
  f.press({13: true}); f.release();          // Send
  f.press({0: true}); f.release();
  assert.strictEqual(t.typed(), 'Olá, ação! 😀 ' + 'x'.repeat(40));
  assert(t.blocks.length >= 2 && t.blocks.every(block => block.length <= 32));
  assert.strictEqual(node('streamOverlayTextInput').value, '', 'nothing is kept after sending');
  assert.strictEqual(f.c.StreamOverlay.isOpen(), false, 'the menu closes after sending');
  assert.strictEqual(f.calls.stop, 0);
  assert.strictEqual(f.calls.quit, 0);
}

// Refusals keep the field and say why; nothing is sent.
for (const [value, failSend, message] of [
  ['', false, 'Digite um texto primeiro.'], ['\n\t', false, 'Digite um texto primeiro.'],
  ['a'.repeat(300), false, 'O texto é longo demais.'], ['abc', true, 'Não foi possível enviar o texto.']]) {
  const t = opened({failSend});
  const {f, node} = t;
  t.enter();
  node('streamOverlayTextInput').value = value;
  f.press({13: true}); f.release();
  f.press({0: true}); f.release();
  assert.strictEqual(f.text('streamOverlayStatus'), message, JSON.stringify(value.slice(0, 5)));
  assert.strictEqual(node('streamOverlayText').hidden, false, 'stays on the text screen');
  assert.strictEqual(node('streamOverlayTextInput').value, value, 'the typed text is kept after a refusal');
  assert.strictEqual(t.blocks.length, 0);
  assert(f.c.StreamOverlay.isOpen());
}

// Back (B and the Back button) returns to the list and forgets the text.
for (const how of ['b', 'button']) {
  const t = opened();
  const {f, node} = t;
  t.enter();
  node('streamOverlayTextInput').value = 'senha secreta';
  if (how === 'b') { f.press({1: true}); f.release(); }
  else { f.press({13: true}); f.release(); f.press({13: true}); f.release(); f.press({0: true}); f.release(); }
  assert.strictEqual(node('streamOverlayActions').hidden, false, how);
  assert.strictEqual(node('streamOverlayText').hidden, true, how);
  assert.strictEqual(node('streamOverlayTextInput').value, '', how + ': the text is forgotten');
  assert.strictEqual(f.c.FocusManager.index(), ORDER.indexOf('text'));
  assert(f.c.StreamOverlay.isOpen());
}

// Every way out of the menu clears the field: typed text is never kept.
for (const leave of ['force', 'hide', 'close', 'busy', 'reopen']) {
  const t = opened();
  const {f, node} = t;
  t.enter();
  node('streamOverlayTextInput').value = 'senha secreta';
  if (leave === 'force') f.c.StreamOverlay.close(true);
  else if (leave === 'hide') f.c.StreamOverlay.hide();
  else if (leave === 'close') f.c.StreamOverlay.close();
  else if (leave === 'busy') f.c.StreamOverlay.busy(true);
  else { f.c.StreamOverlay.close(true); f.c.StreamOverlay.open(); }
  assert.strictEqual(node('streamOverlayTextInput').value, '', leave);
  assert.strictEqual(node('streamOverlayText').hidden, true, leave);
}
{
  const t = opened();
  t.enter();
  t.f.c.StreamOverlay.busy(true);
  assert.strictEqual(t.node('streamOverlayActions').hidden, false, 'a busy menu shows the list');
}

// No timer is needed to type or send.
{
  const t = opened();
  const before = t.f.timers.size;
  t.enter();
  t.node('streamOverlayTextInput').value = 'abc';
  t.f.press({13: true}); t.f.release();
  t.f.press({0: true}); t.f.release();
  assert(t.f.timers.size <= before + 1, 'only the existing menu release timer');
}
// Every fixed text of the stream menu (including Shortcuts and Type text) is in the catalog.
{
  const fs = require('fs'), vm = require('vm');
  const catalog = vm.createContext({});
  vm.runInContext(fs.readFileSync(process.env.ML_CATALOG_FOR_TEST || 'wasm/platform/menu-translations.js', 'utf8'), catalog);
  const known = new Set(vm.runInContext('MenuTranslations', catalog).map(row => row[0]));
  const overlay = fs.readFileSync('wasm/platform/stream-overlay.js', 'utf8');
  const texts = new Set();
  for (const match of overlay.matchAll(/translate\('((?:[^'\\]|\\.)*)'\)/g)) texts.add(match[1].replace(/\\'/g, "'"));
  for (const match of overlay.matchAll(/meta: '((?:[^'\\]|\\.)*)'/g)) texts.add(match[1].replace(/\\'/g, "'"));
  for (const message of ['Type some text first.', 'The text is too long.', 'Could not send the text.', 'Could not send the shortcut.']) texts.add(message);
  const missing = [...texts].filter(text => !known.has(text));
  assert.deepStrictEqual(missing, [], 'untranslated stream menu texts: ' + missing.join(' | '));
  assert(texts.size > 15, 'the menu texts were collected');
}
console.log('stream_overlay_text_test: menu entry, field and keyboard, send and close, refusal messages, Back, text never kept, no extra timers and translation coverage PASS');

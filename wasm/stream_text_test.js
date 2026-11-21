'use strict';
// Typed text for the PC: UTF-8 blocks of at most 32 bytes that never split a
// character, control characters removed, one native call per block.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const source = fs.readFileSync('wasm/platform/stream-text.js', 'utf8');
const PTR = 128;
const plain = value => JSON.parse(JSON.stringify(value));

function env(options = {}) {
  const heap = new ArrayBuffer(4096), sent = [], calls = {buffer: 0};
  const context = vm.createContext({
    isInGame: options.inGame !== false, Array, Object, Number, String, Uint8Array, Math,
    Module: options.noModule ? undefined : {
      HEAP32: {buffer: heap},
      _utf8TextBuffer() { calls.buffer++; return PTR; },
      _sendUtf8Text: options.noSend ? undefined : length => {
        if (options.throwAt === sent.length) throw Error('native failure');
        if (options.failAt === sent.length) return -1;
        sent.push(Array.from(new Uint8Array(heap, PTR, length)));
        return 0;
      }
    }
    // No timers on purpose: sending text must not need any.
  });
  vm.runInContext(source, context);
  return {api: context.StreamText, sent, calls};
}
const bytes = text => Array.from(Buffer.from(text, 'utf8'));
const lengths = blocks => blocks.map(block => block.length);

// Blocks: at most 32 bytes, whole characters only, exact UTF-8.
{
  const {api} = env();
  assert.deepStrictEqual(plain(api.blocks('abc')), [[97, 98, 99]]);
  assert.deepStrictEqual(lengths(plain(api.blocks('a'.repeat(70)))), [32, 32, 6]);
  assert.deepStrictEqual(lengths(plain(api.blocks('a'.repeat(31) + 'ç'))), [31, 2], 'a 2-byte character is not split');
  assert.deepStrictEqual(lengths(plain(api.blocks('a'.repeat(31) + '€'))), [31, 3], 'a 3-byte character is not split');
  assert.deepStrictEqual(lengths(plain(api.blocks('a'.repeat(31) + '😀'))), [31, 4], 'a 4-byte character is not split');
  assert.deepStrictEqual(lengths(plain(api.blocks('ç'.repeat(17)))), [32, 2]);
  assert.deepStrictEqual(lengths(plain(api.blocks('😀'.repeat(10)))), [32, 8]);
  for (const text of ['olá, mundo', 'ação ñ ü', 'senha: Pässw0rd!', '日本語のテキスト', 'x'.repeat(100) + '😀é€' + 'y'.repeat(40)]) {
    const joined = [].concat(...plain(api.blocks(text)));
    assert.deepStrictEqual(joined, bytes(text), text);
    for (const block of plain(api.blocks(text))) {
      assert(block.length >= 1 && block.length <= 32);
      // Each block decodes on its own (no split character).
      assert.strictEqual(Buffer.from(block).toString('utf8').includes('�'), false);
    }
  }
  assert.deepStrictEqual(plain(api.blocks('')), []);
}

// Unpaired surrogates become U+FFFD; control characters are removed.
{
  const {api} = env();
  assert.deepStrictEqual([].concat(...plain(api.blocks('\ud800'))), [0xEF, 0xBF, 0xBD]);
  assert.deepStrictEqual([].concat(...plain(api.blocks('\udc00a'))), [0xEF, 0xBF, 0xBD, 97]);
  assert.deepStrictEqual([].concat(...plain(api.blocks('a\ud83d'))), [97, 0xEF, 0xBF, 0xBD]);
  assert.strictEqual(api.sanitize('a\nb\tc\u007fd\u0000e\u0085f'), 'abcdef');
  assert.strictEqual(api.sanitize('\n\t\u0000'), '');
  assert.strictEqual(api.sanitize('olá 😀'), 'olá 😀');
  assert.strictEqual(api.sanitize(null), '');
  assert.strictEqual(api.sanitize(42), '');
}

// Sending writes each block into the native buffer and asks for one event per block, in order.
{
  const text = 'Olá, ação! ' + 'x'.repeat(70) + ' 😀€';   // 92 bytes: three blocks
  const e = env();
  const result = plain(e.api.send(text));
  assert.deepStrictEqual(result, {ok: true, blocks: e.sent.length});
  assert.deepStrictEqual([].concat(...e.sent), bytes(text));
  assert.strictEqual(e.sent.length, 3);
  assert(e.sent.every(block => block.length <= 32));
  assert.strictEqual(e.calls.buffer, e.sent.length, 'the buffer address is read for each block');
}

// Limits and refusals send nothing.
{
  const e = env();
  assert.strictEqual(e.api.MAX_CHARACTERS, 256);
  assert.deepStrictEqual(plain(e.api.send('a'.repeat(256))).ok, true);
  assert.deepStrictEqual(plain(e.api.send('😀'.repeat(256))).ok, true, 'the limit counts characters, not bytes');
  const before = e.sent.length;
  assert.deepStrictEqual(plain(e.api.send('a'.repeat(257))), {ok: false, reason: 'too-long'});
  assert.deepStrictEqual(plain(e.api.send('')), {ok: false, reason: 'empty'});
  assert.deepStrictEqual(plain(e.api.send('\n\t')), {ok: false, reason: 'empty'});
  assert.deepStrictEqual(plain(e.api.send(undefined)), {ok: false, reason: 'empty'});
  assert.strictEqual(e.sent.length, before);
  assert.strictEqual(plain(env({inGame: false}).api.send('a')).reason, 'no-stream');
  assert.strictEqual(plain(env({noModule: true}).api.send('a')).reason, 'unavailable');
  assert.strictEqual(plain(env({noSend: true}).api.send('a')).reason, 'unavailable');
}

// A native error or exception stops at that block and says how far it got.
{
  const failing = env({failAt: 1});
  assert.deepStrictEqual(plain(failing.api.send('a'.repeat(70))), {ok: false, reason: 'failed', sent: 1});
  assert.strictEqual(failing.sent.length, 1, 'no block after the failure');
  const throwing = env({throwAt: 0});
  assert.deepStrictEqual(plain(throwing.api.send('abc')), {ok: false, reason: 'failed', sent: 0});
  assert.strictEqual(throwing.sent.length, 0);
}
console.log('stream_text_test: whole-character 32-byte blocks, surrogates and control characters, ordered native sends, limits and failures PASS');

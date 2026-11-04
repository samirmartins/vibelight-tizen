'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const cp = require('child_process'), path = require('path'), os = require('os');
let fixture = require('./fixtures/embind-std-string.cjs');
const artifactAt = process.argv.indexOf('--artifact');
if (artifactAt >= 0) {
  const source = fs.readFileSync(process.argv[artifactAt + 1], 'utf8');
  function between(begin, end) {
    const start = source.indexOf(begin), stop = source.indexOf(end, start);
    assert(start >= 0 && stop > start, 'Expected generated runtime functions');
    return source.slice(start, stop);
  }
  fixture = between('function UTF8ArrayToString', 'function stringToUTF8Array') +
    between('function __embind_register_std_string', 'function __embind_register_std_wstring');
  const patcher = require('../build-tools/patch-embind-string.cjs');
  const patched = patcher.patchSource(source);
  patcher.verifySource(patched);
  assert.strictEqual(patched, source.replace(patcher.ORIGINAL, patcher.PATCHED));
}

// Execute the actual generated registration and UTF-8 readers, without booting WASM.
function convert(source, text, utf8 = true, race = false) {
  const bytes = Buffer.from(text, utf8 ? 'utf8' : 'latin1');
  const value = 32, start = value + 4, end = start + bytes.length;
  const memory = new Uint8Array(new ArrayBuffer(end + 16));
  memory.fill(0xa5);
  const words = new Uint32Array(memory.buffer, 0, Math.floor(memory.length / 4));
  words[value >> 2] = bytes.length;
  memory.set(bytes, start);
  const before = Array.from(memory), writes = [], readsOutside = [], freed = [];
  const heap = new Proxy(memory, {
    get(target, key) {
      if (/^\d+$/.test(String(key)) && (+key < start || +key >= end)) readsOutside.push(+key);
      return target[key];
    },
    set(target, key, next) { writes.push([+key, next]); target[key] = next; return true; }
  });
  let binding;
  const context = {
    HEAPU8: heap, HEAPU32: words, ArrayBuffer, Uint8Array, Uint8ClampedArray, Int8Array,
    readLatin1String: () => utf8 ? 'std::string' : 'std::basic_string<unsigned char>',
    registerType: (_, type) => { binding = type; },
    simpleReadValueFromPointer() {}, _free: pointer => freed.push(pointer)
  };
  vm.runInNewContext(source, context);
  if (race) {
    const read = context.UTF8ToString;
    context.UTF8ToString = function(...args) { memory[end] = 0x55; return read(...args); };
  }
  context.__embind_register_std_string(1, 1);
  const result = binding.fromWireType(value);
  return { result, writes, readsOutside, before, after: Array.from(memory), freed, value, end };
}

if (process.argv.includes('--baseline')) {
  const result = convert(fixture, '12345678');
  assert.strictEqual(result.result, '12345678');
  assert.deepStrictEqual(result.writes, [], 'RED: generated converter writes outside the allocation');
  throw Error('The vulnerable fixture unexpectedly passed');
}

const { patchSource, verifySource, ORIGINAL, PATCHED } = require('../build-tools/patch-embind-string.cjs');
const unsafe = convert(fixture, '12345678');
assert.strictEqual(unsafe.result, '12345678');
assert.strictEqual(unsafe.writes.length, 2); // E01: restoration alone hides the illegal write.
assert.deepStrictEqual(unsafe.before, unsafe.after);
assert.strictEqual(convert(fixture, '12345678', true, true).after[unsafe.end], 0xa5);

const safe = patchSource(fixture);
verifySource(safe);
const cases = ['', 'a', 'ab', ...[7,8,9,15,16,17,23,24,25].map(n => 'x'.repeat(n)),
  'ação', '日本語', '🎮🙂', 'ação🎮'.repeat(4096), '\0', '\0abc', 'ab\0cd', 'ab\0', '\0\0', 'ação\0🎮\0'];
for (const text of cases) {
  const result = convert(safe, text);
  assert.strictEqual(result.result, text);
  assert.deepStrictEqual(result.writes, [], 'E06: even transient heap writes are forbidden');
  assert.deepStrictEqual(result.readsOutside, [], 'No terminator byte may be read outside the string');
  assert.deepStrictEqual(result.after, result.before);
  assert.deepStrictEqual(result.freed, [result.value]);
  assert.strictEqual(convert(fixture, text).result, result.result, 'Preserve internal NUL semantics');
}
for (const source of [fixture, safe]) {
  const result = convert(source, '\xff\0\x80', false);
  assert.strictEqual(result.result, '\xff\0\x80');
  assert.deepStrictEqual(result.writes, []);
}
const concurrent = convert(safe, '12345678', true, true);
assert.strictEqual(concurrent.after[concurrent.end], 0x55, 'Do not overwrite another allocator update');
assert.throws(() => patchSource('unrelated code'), /exactly once/);
assert.throws(() => patchSource(fixture + fixture), /exactly once/);
assert.throws(() => patchSource(safe), /exactly once/);
assert.throws(() => patchSource(fixture + PATCHED), /already|protected|mixed/i);
assert.throws(() => verifySource(fixture), /unsafe|vulnerable/i);
assert.throws(() => verifySource('unrelated code'), /exactly once/);
assert.throws(() => verifySource(safe + safe), /exactly once/);
assert.throws(() => verifySource(safe + ORIGINAL), /unsafe|vulnerable/i);
assert.strictEqual(safe, fixture.replace(ORIGINAL, PATCHED), 'E09: preserve all surrounding code');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'embind-test-'));
const patcher = path.resolve('build-tools/patch-embind-string.cjs');
const checker = path.resolve('build-tools/verify-embind-wgt.py');
// These guards supplement execution tests: packaging must consume the installed,
// patched member, and a failed transformation must stop before signing.
for (const recipe of ['Dockerfile', 'build-tools/Dockerfile.package']) {
  const source = fs.readFileSync(recipe, 'utf8');
  const install = source.indexOf('RUN cmake --install build --prefix build');
  const patch = source.indexOf('patch-embind-string.cjs build/widget/moonlight-wasm.js');
  const check = source.indexOf('patch-embind-string.cjs --check build/widget/moonlight-wasm.js');
  const sign = source.indexOf('spawn tizen package');
  assert(install >= 0 && install < patch && patch < check && check < sign, recipe);
  assert.match(source.slice(patch, check), /&&\s*\\\n/);
  assert.match(source, /COPY --chown=moonlight build-tools\/patch-embind-string\.cjs/);
}
function cli(args) { return cp.spawnSync(process.execPath, [patcher, ...args], {encoding:'utf8'}); }
try {
  const file = path.join(directory, 'module.js');
  for (const source of ['unrelated code', fixture + fixture, safe]) {
    fs.writeFileSync(file, source);
    const result = cli([file]);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /exactly once/);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), source, 'Failure must not mutate the file');
  }
  fs.writeFileSync(file, fixture);
  assert.strictEqual(cli([file]).status, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), safe);
  assert.strictEqual(cli(['--check', file]).status, 0);
  assert.notStrictEqual(cli([]).status, 0);
  for (const [name, entries, accepted] of [
    ['safe', [['moonlight-wasm.js', safe]], true],
    ['unsafe', [['moonlight-wasm.js', fixture]], false],
    ['missing', [['other.js', safe]], false],
    ['duplicate', [['moonlight-wasm.js', safe], ['moonlight-wasm.js', fixture]], false],
    ['decoy', [['moonlight-wasm.js', fixture], ['other.js', safe]], false],
    ['unknown', [['moonlight-wasm.js', 'unrelated code']], false]
  ]) {
    const widget = path.join(directory, name + '.wgt');
    const create = cp.spawnSync('python3', ['-c',
      'import zipfile,json,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for n,s in json.loads(sys.argv[2]): z.writestr(n,s)',
      widget, JSON.stringify(entries)], {encoding:'utf8'});
    assert.strictEqual(create.status, 0, create.stderr);
    const check = cp.spawnSync('python3', [checker, widget, '--node', process.execPath], {encoding:'utf8'});
    assert.strictEqual(check.status === 0, accepted, name + ': ' + check.stderr);
  }
} finally { fs.rmSync(directory, {recursive:true, force:true}); }
console.log('embind_string_test: E01-E10, generated UTF-8/NUL behavior, transient writes, allocator interleaving and WGT rejection OK');

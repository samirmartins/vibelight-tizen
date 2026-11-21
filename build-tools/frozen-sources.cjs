'use strict';
// Single source-freeze contract for the gameplay-critical code: native code,
// vendored protocol/codec libraries, build flags and the gameplay JavaScript.
// Any byte change in these files fails wasm/scope_contract_test.js until the
// SHA-256 recorded in wasm/frozen-sources.json is updated in the same commit,
// so every approved change to the playback path is explicit in the diff.
// Menus and interface code are covered by behavioral tests instead.
// Development tooling only; never packaged in the widget.
const crypto = require('crypto'), cp = require('child_process'), fs = require('fs'), path = require('path');

const root = path.resolve(__dirname, '..');
const MANIFEST = 'wasm/frozen-sources.json';
const TREES = Object.freeze(['moonlight-common-c', 'libgamestream', 'h264bitstream', 'opus']);
const GAMEPLAY_JS = Object.freeze(['wasm/platform/audio.js', 'wasm/platform/audio-worklet.js',
  'wasm/platform/gamepad.js', 'wasm/platform/display.js', 'wasm/platform/diagnostics.js']);
// The project version is checked against res/config.xml by the documentation
// test; only that one line is excluded so a release bump does not touch the freeze.
const CMAKE_VERSION = /^project\(MoonlightWasm VERSION [0-9]+\.[0-9]+\.[0-9]+\)$/m;

function listed(...patterns) {
  return cp.execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...patterns],
    {cwd: root, encoding: 'utf8'}).split('\n').filter(Boolean).sort();
}

// Native sources of the application itself, excluding tests and test fixtures.
function nativeFiles() {
  return listed('wasm/*.cpp', 'wasm/*.hpp', 'wasm/*.h', 'wasm/*.c', 'wasm/dispatcher/*.hpp')
    .filter(file => !/(_test|_fixture)\.(c|cpp)$/.test(file) && !file.startsWith('wasm/fixtures/'));
}

function frozenFiles() {
  return [...nativeFiles(), ...GAMEPLAY_JS, 'CMakeLists.txt'].sort();
}

function content(file, read = name => fs.readFileSync(path.join(root, name))) {
  const bytes = read(file);
  if (file !== 'CMakeLists.txt') return bytes;
  const text = bytes.toString('utf8');
  if (!CMAKE_VERSION.test(text)) throw Error('CMakeLists.txt project version line not found');
  return Buffer.from(text.replace(CMAKE_VERSION, 'project(MoonlightWasm VERSION <checked-separately>)'));
}

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fileHash(file, read) {
  return sha(content(file, read));
}

// One digest per vendored tree: sorted relative paths with their file digests.
function treeHash(tree, read) {
  const lines = listed(tree).map(file => file + '\0' + fileHash(file, read) + '\n');
  if (lines.length === 0) throw Error('Frozen tree is empty: ' + tree);
  return sha(lines.join(''));
}

function compute(read) {
  const files = {}, trees = {};
  for (const file of frozenFiles()) files[file] = fileHash(file, read);
  for (const tree of TREES) trees[tree] = treeHash(tree, read);
  return {files, trees};
}

function load() {
  return JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
}

// Human-readable differences between the recorded and the current state.
function differences(recorded, current) {
  const out = [];
  for (const kind of ['files', 'trees']) {
    const names = new Set([...Object.keys(recorded[kind] || {}), ...Object.keys(current[kind])]);
    for (const name of [...names].sort()) {
      const before = (recorded[kind] || {})[name], after = current[kind][name];
      if (before === after) continue;
      out.push((before === undefined ? 'new ' : after === undefined ? 'removed ' : 'changed ') + name);
    }
  }
  return out;
}

function write(state) {
  const body = {
    comment: 'SHA-256 of gameplay-critical sources. Update only in the commit of an approved, tested ' +
      'change to these files: node build-tools/frozen-sources.cjs --update',
    files: state.files, trees: state.trees,
  };
  fs.writeFileSync(path.join(root, MANIFEST), JSON.stringify(body, null, 2) + '\n');
}

module.exports = {MANIFEST, TREES, GAMEPLAY_JS, nativeFiles, frozenFiles, compute, load, differences, write};

if (require.main === module) {
  if (process.argv[2] !== '--update') {
    console.error('Usage: node build-tools/frozen-sources.cjs --update');
    process.exitCode = 2;
  } else {
    const before = fs.existsSync(path.join(root, MANIFEST)) ? load() : {files: {}, trees: {}};
    const after = compute();
    write(after);
    for (const line of differences(before, after)) console.log(line);
  }
}

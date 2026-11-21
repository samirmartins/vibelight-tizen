'use strict';
// The only source-freeze contract (see build-tools/frozen-sources.cjs): native
// code, vendored protocol/codec libraries, build flags and gameplay JavaScript
// must match wasm/frozen-sources.json byte for byte. Menus and interface are
// covered by behavioral tests. Updating a hash belongs only in the commit of an
// approved, tested change to that file.
const assert = require('assert'), fs = require('fs');
const frozen = require('../build-tools/frozen-sources.cjs');

const recorded = frozen.load();
const current = frozen.compute();
const changes = frozen.differences(recorded, current);
assert.deepStrictEqual(changes, [], 'gameplay-critical sources changed: ' + changes.join(', ') +
  '. If the change is approved and tested, run: node build-tools/frozen-sources.cjs --update');

// The contract covers every native application source automatically, so a new
// native file cannot escape it, and never covers tests or fixtures.
const files = Object.keys(recorded.files);
for (const file of frozen.nativeFiles()) assert(files.includes(file), 'native source frozen: ' + file);
for (const file of [...frozen.GAMEPLAY_JS, 'CMakeLists.txt', 'wasm/wasmplayer.cpp', 'wasm/auddec.cpp',
  'wasm/gamepad.cpp', 'wasm/input.cpp', 'wasm/main.cpp', 'wasm/frame_pacing.hpp']) assert(files.includes(file), file);
assert(files.every(file => !/(_test|_fixture)\.(c|cpp|js)$/.test(file)), 'tests are not frozen');
assert.deepStrictEqual(Object.keys(recorded.trees).sort(), [...frozen.TREES].sort());

// Negative controls: one changed byte in a file or inside a vendored tree, and
// the CMake version line alone, are detected or ignored exactly as specified.
const read = name => fs.readFileSync(require('path').join(__dirname, '..', name));
const tamper = target => name => name === target ? Buffer.concat([read(name), Buffer.from(' ')]) : read(name);
assert.deepStrictEqual(frozen.differences(recorded, frozen.compute(tamper('wasm/wasmplayer.cpp'))), ['changed wasm/wasmplayer.cpp']);
assert.deepStrictEqual(frozen.differences(recorded, frozen.compute(tamper('moonlight-common-c/src/RtpVideoQueue.c'))), ['changed moonlight-common-c']);
const cmake = read('CMakeLists.txt').toString('utf8');
const bumped = name => name === 'CMakeLists.txt' ? Buffer.from(cmake.replace(/(project\(MoonlightWasm VERSION )[0-9.]+\)/, '$199.0.0)')) : read(name);
assert.deepStrictEqual(frozen.differences(recorded, frozen.compute(bumped)), [], 'version bump alone is checked by the documentation test');
const flags = name => name === 'CMakeLists.txt' ? Buffer.from(cmake.replace('cmake_minimum_required', '# edit\ncmake_minimum_required')) : read(name);
assert.deepStrictEqual(frozen.differences(recorded, frozen.compute(flags)), ['changed CMakeLists.txt']);

// Installation identity: updates over an existing install keep pairing and preferences.
const config = fs.readFileSync('res/config.xml', 'utf8');
assert(config.includes('id="http://samsung.tv/MoonlightWasm"'), 'widget id');
assert(config.includes('<tizen:application id="MoonLightS.MoonlightWasm" package="MoonLightS"'), 'application id and package');
assert(config.includes('<name>VibeLight</name>'), 'application name');
console.log('scope_contract_test: ' + files.length + ' files and ' + Object.keys(recorded.trees).length +
  ' vendored trees frozen; new native files covered; tamper, tree and CMake-version controls; installation identity OK');

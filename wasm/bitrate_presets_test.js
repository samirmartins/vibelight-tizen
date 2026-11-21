'use strict';
// Default bitrate per resolution and frame rate (applied when the user picks a
// resolution or FPS) and the first-run/restore default: all agree on 1080p60.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), cp = require('child_process');
const index = fs.readFileSync('wasm/platform/index.js', 'utf8');
const html = fs.readFileSync('wasm/index.html', 'utf8');
const sliceFunction = (text, name) => {
  const a = text.indexOf('function ' + name + '(');
  assert(a >= 0, 'missing ' + name);
  return text.slice(a, text.indexOf('\n}\n', a) + 3);
};
function presetFor(source, resolution, frameRate) {
  const applied = [];
  let saved = 0;
  const context = vm.createContext({console: {log() {}},
    $: selector => selector === '#selectResolution' ? {data: () => resolution}
      : selector === '#selectFramerate' ? {data: () => frameRate}
      : {0: {MaterialSlider: {change: value => applied.push(value)}}},
    saveBitrate() { saved++; }});
  vm.runInContext(sliceFunction(source, 'standardBitratePresets'), context);
  context.standardBitratePresets();
  assert.strictEqual(saved, 1, 'the new value is saved once');
  return applied.length === 1 ? applied[0] : applied;
}
const released = cp.execFileSync('git', ['show', 'v4.0.4:wasm/platform/index.js'], {encoding: 'utf8'});

// Mbps at 30 and 60 FPS, chosen for good image quality without excess.
const TABLE = {'854:480': {30: '4', 60: '6'}, '1280:720': {30: '10', 60: '15'}, '1920:1080': {30: '20', 60: '30'},
  '2560:1440': {30: '40', 60: '50'}, '3840:2160': {30: '60', 60: '80'}};
for (const [resolution, rates] of Object.entries(TABLE)) {
  for (const [rate, mbps] of Object.entries(rates)) {
    assert.strictEqual(presetFor(index, resolution, rate), mbps, resolution + ' @' + rate);
  }
}

// Everything else is exactly what v4.0.4 did: other frame rates and the fallback.
for (const resolution of [...Object.keys(TABLE), '1024:768']) {
  for (const rate of ['90', '120', '144']) {
    assert.deepStrictEqual(presetFor(index, resolution, rate), presetFor(released, resolution, rate), resolution + ' @' + rate);
  }
}
assert.strictEqual(presetFor(index, '1024:768', '60'), presetFor(released, '1024:768', '60'), 'unknown resolutions keep the fallback');

// The first-run default, the Restore defaults value and the slider markup are the 1080p60 value.
const restore = (sliceFunction(index, 'restoreDefaultsSettingsValues').match(/const defaultBitrate = '([0-9.]+)'/) || [])[1];
const fallback = (index.match(/previousValue\.bitrate != null \? previousValue\.bitrate : '([0-9.]+)'/) || [])[1];
const markup = (html.match(/id="bitrateSlider"[^>]*value="([0-9.]+)"/) || [])[1];
assert.deepStrictEqual([restore, fallback, markup], [TABLE['1920:1080'][60], TABLE['1920:1080'][60], TABLE['1920:1080'][60]],
  'picking 1080p60 must not change the default bitrate');
assert(/const defaultFramerate = '60'/.test(index) && index.includes("'1920:1080'"), 'the default is 1080p60');
console.log('bitrate_presets_test: Mbps per resolution at 30/60 FPS, v4.0.4 values kept for 90/120/144 FPS and fallback, defaults agree with 1080p60 PASS');

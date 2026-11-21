'use strict';
// Compact profile editor model: six rows, "Default" meaning the Settings value,
// bitrate in 0.5 Mbps steps with hold acceleration, and the HDR/H.264 rule.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const store = new Map();
const context = vm.createContext({localStorage: {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v)},
  JSON, Object, Array, Number, String, isFinite, Math});
// Same load order as index.html.
for (const file of ['stream-profiles.js', 'stream-profile-menu.js']) vm.runInContext(fs.readFileSync('wasm/platform/' + file, 'utf8'), context);
const Editor = context.StreamProfileEditor;
const plain = value => JSON.parse(JSON.stringify(value));
const SETTINGS = {resolution: '1920:1080', frameRate: '60', bitrate: 30, codec: 'H264', hdr: false, audio: 'Stereo'};
let clock = 0;
const make = (profile, settings = SETTINGS, limits = {maxWidth: 3840}) =>
  Editor.create({profile, settings, limits, now: () => clock});
const row = (editor, id) => plain(editor.rows().find(item => item.id === id));

// A new editor starts on Default everywhere and shows the Settings value.
{
  const editor = make(null);
  assert.deepStrictEqual(plain(editor.rows().map(item => item.id)), ['resolution', 'frameRate', 'bitrate', 'codec', 'hdr', 'audio']);
  assert.deepStrictEqual(row(editor, 'resolution'), {id: 'resolution', label: 'Resolution', text: 'Default', defaultText: '1080p', isDefault: true});
  assert.strictEqual(row(editor, 'frameRate').defaultText, '60 FPS');
  assert.strictEqual(row(editor, 'bitrate').defaultText, '30 Mbps');
  assert.strictEqual(row(editor, 'codec').defaultText, 'H.264');
  assert.strictEqual(row(editor, 'hdr').defaultText, 'Off');
  assert.strictEqual(row(editor, 'audio').defaultText, 'Stereo');
  assert.deepStrictEqual(plain(editor.profile()), {});
}

// An existing profile is shown and returned unchanged.
{
  const saved = {resolution: '2560:1440', frameRate: '30', bitrate: 60.5, codec: 'HEVC', hdr: true, audio: '51Surround'};
  const editor = make(saved);
  assert.deepStrictEqual(plain(editor.rows().map(item => item.text)), ['1440p', '30 FPS', '60.5 Mbps', 'HEVC', 'On', '5.1 Surround']);
  assert.deepStrictEqual(plain(editor.profile()), saved);
}

// Short lists cycle through Default and wrap in both directions.
{
  const editor = make(null);
  const seen = [];
  for (let i = 0; i < 6; i++) { editor.adjust('resolution', 1); seen.push(row(editor, 'resolution').text); }
  assert.deepStrictEqual(seen, ['480p', '720p', '1080p', '1440p', '4K', 'Default']);
  editor.adjust('resolution', -1);
  assert.strictEqual(row(editor, 'resolution').text, '4K');
  for (const [id, expected] of [['frameRate', ['30 FPS', '60 FPS', 'Default']], ['codec', ['H.264', 'HEVC', 'AV1', 'Default']],
      ['hdr', ['On', 'Off', 'Default']], ['audio', ['Stereo', '5.1 Surround', '7.1 Surround', 'Default']]]) {
    const cycle = [];
    for (let i = 0; i < expected.length; i++) { editor.adjust(id, 1); cycle.push(row(editor, id).text); }
    assert.deepStrictEqual(cycle, expected, id);
  }
}

// The panel limit hides resolutions the TV cannot show.
{
  const editor = make(null, SETTINGS, {maxWidth: 1920});
  const seen = [];
  for (let i = 0; i < 5; i++) { editor.adjust('resolution', 1); seen.push(row(editor, 'resolution').text); }
  assert.deepStrictEqual(seen, ['480p', '720p', '1080p', 'Default', '480p']);
}

// Bitrate: Default <-> Settings value, then 0.5 Mbps steps within 0.5..150, no wrap.
{
  clock = 0;
  const editor = make(null);
  editor.adjust('bitrate', 1);
  assert.strictEqual(row(editor, 'bitrate').text, '30 Mbps', 'leaving Default starts at the Settings value');
  assert.strictEqual(plain(editor.profile()).bitrate, 30);
  clock += 1000; editor.adjust('bitrate', 1);
  assert.strictEqual(row(editor, 'bitrate').text, '30.5 Mbps');
  clock += 1000; editor.adjust('bitrate', -1); clock += 1000; editor.adjust('bitrate', -1);
  assert.strictEqual(row(editor, 'bitrate').text, '29.5 Mbps');
  const low = make({bitrate: 1});
  clock += 1000; low.adjust('bitrate', -1);
  assert.strictEqual(row(low, 'bitrate').text, '0.5 Mbps');
  clock += 1000; low.adjust('bitrate', -1);
  assert.strictEqual(row(low, 'bitrate').text, 'Default', 'below 0.5 returns to Default');
  const high = make({bitrate: 149.5});
  clock += 1000; high.adjust('bitrate', 1);
  assert.strictEqual(row(high, 'bitrate').text, '150 Mbps');
  clock += 1000; high.adjust('bitrate', 1);
  assert.strictEqual(row(high, 'bitrate').text, '150 Mbps', 'no wrap at the maximum');
}

// Holding a direction accelerates after one second; a pause or a reversal resets it.
{
  clock = 0;
  const editor = make({bitrate: 30});
  const values = [];
  for (let i = 0; i < 14; i++) { editor.adjust('bitrate', 1); values.push(plain(editor.profile()).bitrate); clock += 100; }
  // 0 to 1000 ms in 0.5 steps, then 5 Mbps steps while still held.
  assert.deepStrictEqual(values.slice(0, 10), [30.5, 31, 31.5, 32, 32.5, 33, 33.5, 34, 34.5, 35]);
  assert.deepStrictEqual(values.slice(10), [40, 45, 50, 55]);
  clock += 1000; editor.adjust('bitrate', 1);
  assert.strictEqual(plain(editor.profile()).bitrate, 55.5, 'a pause resets to fine steps');
  clock += 100; editor.adjust('bitrate', -1);
  assert.strictEqual(plain(editor.profile()).bitrate, 55, 'reversing resets to fine steps');
  const capped = make({bitrate: 148});
  clock = 0;
  for (let i = 0; i < 40; i++) { capped.adjust('bitrate', 1); clock += 100; }
  assert.strictEqual(plain(capped.profile()).bitrate, 150, 'acceleration never passes the maximum');
  const floor = make({bitrate: 4});
  clock = 0;
  for (let i = 0; i < 40; i++) { floor.adjust('bitrate', -1); clock += 100; }
  assert.strictEqual(row(floor, 'bitrate').text, 'Default', 'holding down ends on Default instead of jumping back to the Settings value');
}

// HDR needs HEVC or AV1.
{
  const editor = make({codec: 'H264'});
  assert.strictEqual(editor.problem(), null);
  editor.adjust('hdr', 1);
  assert.strictEqual(row(editor, 'hdr').text, 'On');
  assert.strictEqual(editor.problem(), 'hdr-needs-hevc-or-av1', 'explicit H.264 with HDR cannot be saved');
  assert.strictEqual(editor.hint(), null);
  const partial = make(null);
  partial.adjust('hdr', 1);
  assert.strictEqual(partial.problem(), null, 'HDR alone is allowed');
  assert.strictEqual(partial.hint(), 'hdr-needs-hevc-or-av1', 'but the Settings codec is H.264, so it would start without HDR');
  const withHevc = make(null, {...SETTINGS, codec: 'HEVC'});
  withHevc.adjust('hdr', 1);
  assert.strictEqual(withHevc.hint(), null);
  const settingsHdr = make({codec: 'H264'}, {...SETTINGS, codec: 'HEVC', hdr: true});
  assert.strictEqual(settingsHdr.hint(), 'hdr-needs-hevc-or-av1', 'Settings HDR with a H.264 profile starts without HDR');
}

// The draft equals what the module stores.
{
  const editor = make(null);
  for (let i = 0; i < 3; i++) editor.adjust('resolution', 1);
  editor.adjust('bitrate', 1);
  for (let i = 0; i < 2; i++) editor.adjust('codec', 1);
  assert.deepStrictEqual(plain(editor.profile()), {resolution: '1920:1080', bitrate: 30, codec: 'HEVC'});
  assert.strictEqual(context.StreamProfiles.setHost('pc', editor.profile()), true, 'valid for the profile store');
  assert.strictEqual(editor.changed(), true);
  assert.strictEqual(make({bitrate: 20}).changed(), false);
}
console.log('stream_profile_editor_test: Default rows, cycling, panel limit, 0.5 Mbps steps with hold acceleration, limits and HDR rule PASS');

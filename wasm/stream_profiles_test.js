'use strict';
// Per-PC and per-game streaming profiles: storage, validation, priority and the
// effective values used at launch. No DOM, timer or network work exists in the module.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const source = fs.readFileSync('wasm/platform/stream-profiles.js', 'utf8');

function load(initial, options = {}) {
  const store = new Map(initial === undefined ? [] : [['vibelight.stream-profiles.v1', initial]]);
  const localStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem(key, value) { if (options.failWrites) throw Error('QuotaExceededError'); store.set(key, value); },
    removeItem: key => store.delete(key)
  };
  const context = {localStorage, JSON, Object, Array, Number, String, isFinite, Math};
  vm.createContext(context);
  vm.runInContext(source, context);
  // Objects built inside the VM have another Object.prototype; compare plain copies.
  const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const api = {};
  for (const [name, fn] of Object.entries(context.StreamProfiles))
    api[name] = typeof fn === 'function' ? (...args) => plain(fn(...args)) : plain(fn);
  return {api, store, context};
}
const GLOBAL = {resolution: '1920:1080', frameRate: '60', bitrate: 30, codec: 'H264', hdr: false, audio: 'Stereo'};
const LIMITS = {maxWidth: 3840};
const KEY = 'vibelight.stream-profiles.v1';

// No profile: nothing changes, byte for byte.
{
  const {api} = load();
  assert.deepStrictEqual(api.resolve('pc-a', 7), {source: 'none', fields: {}, values: {}});
  const effective = api.effective('pc-a', 7, GLOBAL, LIMITS);
  assert.deepStrictEqual(effective.values, GLOBAL);
  assert.strictEqual(effective.source, 'none');
  assert.deepStrictEqual(effective.notes, []);
  assert.deepStrictEqual(api.get(), {version: 1, hosts: {}});
}

// Priority is game, then PC, then global, field by field.
{
  const {api} = load();
  assert.strictEqual(api.setHost('pc-a', {resolution: '2560:1440', bitrate: 60, audio: '51Surround'}), true);
  assert.strictEqual(api.setGame('pc-a', 7, {resolution: '1280:720', codec: 'HEVC'}), true);
  const game = api.effective('pc-a', 7, GLOBAL, LIMITS);
  assert.deepStrictEqual(game.values, {resolution: '1280:720', frameRate: '60', bitrate: 60, codec: 'HEVC', hdr: false, audio: '51Surround'});
  assert.strictEqual(game.source, 'game');
  assert.deepStrictEqual(game.fields, {resolution: 'game', bitrate: 'host', codec: 'game', audio: 'host'});
  const other = api.effective('pc-a', 8, GLOBAL, LIMITS);
  assert.deepStrictEqual(other.values, {resolution: '2560:1440', frameRate: '60', bitrate: 60, codec: 'H264', hdr: false, audio: '51Surround'});
  assert.strictEqual(other.source, 'host');
  const elsewhere = api.effective('pc-b', 7, GLOBAL, LIMITS);
  assert.deepStrictEqual(elsewhere.values, GLOBAL);
  assert.strictEqual(elsewhere.source, 'none');
  // Same title id on different PCs never shares a profile.
  assert.strictEqual(api.resolve('pc-b', 7).source, 'none');
}

// Validation: only known fields with allowed values; H.264 cannot carry HDR.
{
  const {api, store} = load();
  const valid = [{resolution: '854:480'}, {resolution: '3840:2160', frameRate: '30'}, {bitrate: 0.5}, {bitrate: 150},
    {codec: 'AV1', hdr: true}, {audio: '71Surround'}, {hdr: false, codec: 'H264'}];
  for (const profile of valid) assert.strictEqual(api.setHost('pc-v', profile), true, JSON.stringify(profile));
  const invalid = [{resolution: '1921:1080'}, {resolution: 1920}, {frameRate: '120'}, {frameRate: 60}, {bitrate: 0.4},
    {bitrate: 151}, {bitrate: 30.3}, {bitrate: NaN}, {bitrate: '30'}, {codec: 'VP9'}, {hdr: 1}, {hdr: 'true'},
    {audio: 'Mono'}, {codec: 'H264', hdr: true}, {unknown: 1}, {resolution: '1920:1080', pacing: true}, null, [], 'x', 5];
  for (const profile of invalid) {
    const before = store.get(KEY);
    assert.strictEqual(api.setHost('pc-i', profile), false, JSON.stringify(profile));
    assert.strictEqual(store.get(KEY), before, 'a rejected profile writes nothing');
  }
  assert.strictEqual(api.resolve('pc-i', 1).source, 'none');
  for (const uid of ['', '__proto__', 'constructor', 'prototype', 'x'.repeat(129), 5, null, undefined])
    assert.strictEqual(api.setHost(uid, {bitrate: 20}), false, String(uid));
  for (const appId of ['', 'abc', -1, 1.5, 12345678901, null, undefined, '__proto__'])
    assert.strictEqual(api.setGame('pc-i', appId, {bitrate: 20}), false, String(appId));
  assert.strictEqual(Object.prototype.polluted, undefined);
}

// An empty profile means no profile.
{
  const {api} = load();
  api.setHost('pc-a', {bitrate: 20});
  assert.strictEqual(api.setHost('pc-a', {}), true);
  assert.strictEqual(api.resolve('pc-a', 1).source, 'none');
  assert.deepStrictEqual(api.get(), {version: 1, hosts: {}});
}

// HDR cannot be combined with H.264: the stream falls back to SDR, as in Settings.
{
  const {api} = load();
  api.setGame('pc-a', 1, {hdr: true});
  const withH264 = api.effective('pc-a', 1, GLOBAL, LIMITS);
  assert.strictEqual(withH264.values.hdr, false);
  assert.deepStrictEqual(withH264.notes, ['hdr-needs-hevc-or-av1']);
  const withHevc = api.effective('pc-a', 1, {...GLOBAL, codec: 'HEVC'}, LIMITS);
  assert.strictEqual(withHevc.values.hdr, true);
  assert.deepStrictEqual(withHevc.notes, []);
  api.setGame('pc-a', 2, {codec: 'H264'});
  const globalHdr = api.effective('pc-a', 2, {...GLOBAL, codec: 'HEVC', hdr: true}, LIMITS);
  assert.strictEqual(globalHdr.values.hdr, false);
  assert.deepStrictEqual(globalHdr.notes, ['hdr-needs-hevc-or-av1']);
  // Without a profile the global combination is returned untouched.
  const untouched = api.effective('pc-a', 3, {...GLOBAL, codec: 'H264', hdr: true}, LIMITS);
  assert.strictEqual(untouched.values.hdr, true);
}

// A resolution the panel cannot show is ignored; the global value is used.
{
  const {api} = load();
  api.setHost('pc-a', {resolution: '3840:2160', bitrate: 80});
  const limited = api.effective('pc-a', 1, GLOBAL, {maxWidth: 1920});
  assert.strictEqual(limited.values.resolution, '1920:1080');
  assert.strictEqual(limited.values.bitrate, 80);
  assert.deepStrictEqual(limited.notes, ['resolution-over-panel-limit']);
  assert.strictEqual(limited.fields.resolution, undefined);
}

// Persistence: round trip, corrupt data, unknown version, invalid entries.
{
  const first = load();
  first.api.setHost('pc-a', {resolution: '2560:1440', frameRate: '30', bitrate: 45.5, codec: 'HEVC', hdr: true, audio: '51Surround'});
  first.api.setGame('pc-a', 7, {bitrate: 12});
  const second = load(first.store.get(KEY));
  assert.deepStrictEqual(second.api.get(), first.api.get());
  assert.strictEqual(second.api.resolve('pc-a', 7).fields.bitrate, 'game');
  for (const bad of ['not json', '{', '[]', 'null', '7', '{"version":2,"hosts":{}}', '{"version":1}', '{"version":1,"hosts":[]}']) {
    const {api, store} = load(bad);
    assert.deepStrictEqual(api.get(), {version: 1, hosts: {}}, bad);
    assert.deepStrictEqual(api.effective('pc-a', 7, GLOBAL, LIMITS).values, GLOBAL, bad);
    assert.strictEqual(store.get(KEY), bad, 'loading never rewrites stored data');
  }
  const mixed = JSON.stringify({version: 1, hosts: {
    good: {host: {bitrate: 20}, games: {7: {codec: 'AV1'}, abc: {bitrate: 5}, 8: {bitrate: 999}}},
    bad: {host: {codec: 'VP9'}, games: 5},
    '__proto__': {host: {bitrate: 5}}
  }});
  const {api} = load(mixed);
  assert.deepStrictEqual(api.get(), {version: 1, hosts: {good: {host: {bitrate: 20}, games: {7: {codec: 'AV1'}}}}});
}

// A failed write reports failure and leaves memory and storage unchanged.
{
  const {api, store} = load(undefined, {failWrites: true});
  assert.strictEqual(api.setHost('pc-a', {bitrate: 20}), false);
  assert.deepStrictEqual(api.get(), {version: 1, hosts: {}});
  assert.strictEqual(store.has(KEY), false);
  assert.strictEqual(api.effective('pc-a', 1, GLOBAL, LIMITS).source, 'none');
}

// Removal: one game, one PC profile, everything for a forgotten PC, all profiles.
{
  const {api} = load();
  api.setHost('pc-a', {bitrate: 20}); api.setGame('pc-a', 1, {bitrate: 10}); api.setGame('pc-a', 2, {bitrate: 11});
  api.setHost('pc-b', {bitrate: 30}); api.setGame('pc-b', 1, {bitrate: 12});
  assert.strictEqual(api.clearGame('pc-a', 1), true);
  assert.strictEqual(api.resolve('pc-a', 1).source, 'host');
  assert.strictEqual(api.clearHost('pc-a'), true);
  assert.strictEqual(api.resolve('pc-a', 2).source, 'game');
  assert.strictEqual(api.resolve('pc-a', 3).source, 'none');
  assert.strictEqual(api.forgetHost('pc-a'), true);
  assert.strictEqual(api.resolve('pc-a', 2).source, 'none');
  assert.strictEqual(api.resolve('pc-b', 1).source, 'game');
  assert.deepStrictEqual(api.count(), {hosts: 1, games: 1});
  assert.strictEqual(api.hasGame('pc-b', 1), true);
  assert.strictEqual(api.hasGame('pc-b', 2), false);
  assert.strictEqual(api.hasGame('pc-a', 1), false);
  assert.strictEqual(api.hasGame('__proto__', 1), false);
  assert.strictEqual(api.clearAll(), true);
  assert.deepStrictEqual(api.get(), {version: 1, hosts: {}});
  assert.deepStrictEqual(api.count(), {hosts: 0, games: 0});
  assert.strictEqual(api.clearGame('missing', 1), true, 'removing what does not exist succeeds');
}

// Bounded storage.
{
  const {api} = load();
  for (let i = 0; i < 32; i++) assert.strictEqual(api.setHost('pc-' + i, {bitrate: 20}), true);
  assert.strictEqual(api.setHost('pc-extra', {bitrate: 20}), false, 'at most 32 PCs');
  assert.strictEqual(api.setHost('pc-0', {bitrate: 25}), true, 'existing PCs can still be edited');
  for (let i = 1; i <= 300; i++) assert.strictEqual(api.setGame('pc-0', i, {bitrate: 20}), true);
  assert.strictEqual(api.setGame('pc-0', 301, {bitrate: 20}), false, 'at most 300 game profiles per PC');
}

// The module is inert: no timers, network, DOM or frame work.
assert(!/setTimeout|setInterval|requestAnimationFrame|XMLHttpRequest|fetch\(|document\./.test(source));
// get() returns copies: callers cannot change stored state.
{
  const {api} = load();
  api.setHost('pc-a', {bitrate: 20});
  api.get().hosts['pc-a'].host.bitrate = 99;
  assert.strictEqual(api.resolve('pc-a', 1).values.bitrate, 20);
}
console.log('stream_profiles_test: no-profile identity, game>PC>global priority, validation, HDR/H.264 rule, panel limit, persistence and corruption, failed writes, removal and bounds PASS');

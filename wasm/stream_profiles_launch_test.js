'use strict';
// The production startGame with profiles: no profile starts exactly like v4.0.4,
// a profile changes only its own fields and Play/Resume share the same values.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), cp = require('child_process');
const prelude = fs.readFileSync('wasm/fixtures/app-lifecycle-prelude.js', 'utf8');
const profilesSource = ['stream-profiles.js', 'stream-profile-menu.js']
  .map(file => fs.readFileSync('wasm/platform/' + file, 'utf8')).join('\n');
const sliceLauncher = text => text.slice(text.indexOf('function startGame('), text.indexOf('// Stop the running app title'));
const current = sliceLauncher(fs.readFileSync('wasm/platform/index.js', 'utf8'));
const released = sliceLauncher(cp.execFileSync('git', ['show', 'v4.0.4:wasm/platform/index.js'], {encoding: 'utf8'}));
assert(released.startsWith('function startGame(') && current.startsWith('function startGame('));
const h = {require, console};
vm.createContext(h);
vm.runInContext(prelude + '\nglobalThis.make=fixture;globalThis.launch=realLauncher;', h);

// Fixture globals: 1080p60, 30 Mbps, H.264, SDR, stereo (see realLauncher).
async function run(options = {}) {
  const f = h.make(), resume = !!options.resume;
  const r = h.launch(f, 'none', resume, options.source || current);
  const c = f.c, launches = [], refresh = [], diagnostics = [], notices = [], stages = [];
  c.StreamStartup = {begin() {}, finish() {}, cover() {}, native() {}, active: () => true, failure: () => '',
    stage: text => stages.push(text)};
  c.maxSupportedWidth = options.maxWidth || 3840;
  c.getDisplayRefreshRateX100 = rate => { refresh.push(rate); return 6000; };
  c.SessionDiagnostics.configure = value => diagnostics.push(value);
  c.snackbarLog = c.snackbarLogLong = text => notices.push(text);
  const base = f.host.launchApp;
  f.host.launchApp = f.host.resumeApp = (...args) => { launches.push(args); return base(); };
  if (options.stored !== undefined) c.localStorage.setItem('vibelight.stream-profiles.v1', options.stored);
  let api = null;
  if (options.profiles !== false) {
    vm.runInContext(profilesSource, c);
    api = c.StreamProfiles;
    for (const [uid, entry] of Object.entries(options.profiles || {})) {
      if (entry.host) assert(api.setHost(uid, entry.host));
      for (const [id, profile] of Object.entries(entry.games || {})) assert(api.setGame(uid, Number(id), profile));
    }
  }
  const timersBefore = f.timers.size;
  c.startGame(f.host, 2);
  await f.flush();
  const start = r.calls.find(x => x && x.kind === 'startRequest');
  assert(start, 'the stream request is sent');
  // Each run has its own VM realm; compare plain copies.
  const plain = value => JSON.parse(JSON.stringify(value === undefined ? null : value, (key, item) => item === undefined ? '<undefined>' : item));
  return {args: plain(start.args), launches: plain(launches), refresh: plain(refresh), diagnostics: plain(diagnostics),
    notices: plain(notices), stages: plain(stages), timersAdded: f.timers.size - timersBefore, api};
}
const A = {width: 2, height: 3, fps: 4, bitrate: 5, audio: 16, codec: 19, hdr: 20};

(async () => {
  // No profile (module absent, empty, or only another PC/game): identical to v4.0.4.
  for (const resume of [false, true]) {
    const baseline = await run({source: released, profiles: false, resume});
    for (const options of [{profiles: false}, {}, {profiles: {'other-pc': {host: {bitrate: 5}}}},
        {profiles: {'fixture-pc': {games: {9: {bitrate: 5}}}}}, {stored: 'not json'}]) {
      const result = await run({...options, resume});
      assert.deepStrictEqual(result.args, baseline.args, 'startRequest matches v4.0.4');
      assert.deepStrictEqual(result.launches, baseline.launches, 'launch/resume request matches v4.0.4');
      assert.deepStrictEqual(result.refresh, baseline.refresh);
      assert.deepStrictEqual(result.diagnostics, baseline.diagnostics);
      assert.deepStrictEqual(result.stages, baseline.stages, 'startup messages match v4.0.4');
      assert.deepStrictEqual(result.notices, baseline.notices);
      assert.strictEqual(result.timersAdded, baseline.timersAdded, 'no extra timer');
    }
  }

  // A game profile changes exactly its fields, for Play and for Resume.
  const game = {resolution: '2560:1440', frameRate: '30', bitrate: 60, codec: 'HEVC', hdr: true, audio: '51Surround'};
  for (const resume of [false, true]) {
    const baseline = await run({source: released, profiles: false, resume});
    const result = await run({resume, profiles: {'fixture-pc': {games: {2: game}}}});
    assert.strictEqual(result.args[A.width], '2560');
    assert.strictEqual(result.args[A.height], '1440');
    assert.strictEqual(result.args[A.fps], '30');
    assert.strictEqual(result.args[A.bitrate], '60000');
    assert.strictEqual(result.args[A.codec], 'HEVC');
    assert.strictEqual(result.args[A.hdr], 1);
    assert.strictEqual(result.args[A.audio], '51Surround');
    // launchApp(appId, mode, optimize, key, keyId, hdr, ...) and resumeApp(mode, optimize, key, keyId, hdr, ...).
    const launch = result.launches[0], at = resume ? 0 : 1;
    if (!resume) assert.strictEqual(launch[0], 2);
    assert.strictEqual(launch[at], '2560x1440x30');
    assert.strictEqual(launch[at + 1], baseline.launches[0][at + 1], 'game optimization setting unchanged');
    assert.strictEqual(launch[at + 4], 1, 'host is asked for HDR');
    assert.deepStrictEqual(result.refresh, ['30'], 'the display reference follows the stream frame rate');
    // Everything else is identical to the unprofiled start.
    const same = baseline.args.map((value, index) => Object.values(A).includes(index) ? null : value);
    assert.deepStrictEqual(result.args.map((value, index) => Object.values(A).includes(index) ? null : value), same);
    assert.strictEqual(result.diagnostics[0].config.hdr, true);
    assert.strictEqual(result.diagnostics[0].config.bitrate, 60);
    assert.strictEqual(result.diagnostics[0].config.audio, '51Surround');
    assert.strictEqual(result.timersAdded, baseline.timersAdded);
    assert(result.stages.includes('Starting Example Game... · Game profile: 1440p · 30 FPS · 60 Mbps · HEVC · HDR on · 5.1 Surround'),
      'the start shows the profile origin and its values: ' + JSON.stringify(result.stages));
    assert.strictEqual(result.stages.filter(text => /^Starting Example Game/.test(text)).length, 1);
  }

  // PC profile for every game; a game profile overrides it field by field.
  {
    const profiles = {'fixture-pc': {host: {resolution: '1280:720', bitrate: 12, audio: '71Surround'}, games: {2: {bitrate: 25}}}};
    const result = await run({profiles});
    assert.strictEqual(result.args[A.width], '1280');
    assert.strictEqual(result.args[A.height], '720');
    assert.strictEqual(result.args[A.bitrate], '25000', 'game bitrate wins');
    assert.strictEqual(result.args[A.audio], '71Surround', 'PC audio applies');
    assert.strictEqual(result.args[A.codec], 'H264', 'global codec fills the rest');
    assert.strictEqual(result.args[A.fps], '60');
    const hostOnly = await run({profiles: {'fixture-pc': {host: {bitrate: 12}}}});
    assert.strictEqual(hostOnly.args[A.bitrate], '12000');
    assert(hostOnly.stages.includes('Starting Example Game... · PC profile: 12 Mbps'), JSON.stringify(hostOnly.stages));
    assert(result.stages.includes('Starting Example Game... · Game profile: 720p · 25 Mbps · 7.1 Surround'),
      'both layers contribute their fields: ' + JSON.stringify(result.stages));
  }

  // HDR needs HEVC or AV1: the stream starts in SDR and the player is told why.
  {
    const result = await run({profiles: {'fixture-pc': {games: {2: {hdr: true}}}}});
    assert.strictEqual(result.args[A.hdr], 0);
    assert.strictEqual(result.launches[0][5], 0, 'host is not asked for HDR');
    assert.strictEqual(result.diagnostics[0].config.hdr, false);
    assert(result.stages.some(text => text.includes('HDR off') && text.includes('HDR is off in this profile: it needs HEVC or AV1.')),
      'HDR fallback is announced in the start message: ' + JSON.stringify(result.stages));
  }

  // A resolution above the panel limit is ignored (global value used).
  {
    const result = await run({maxWidth: 1920, profiles: {'fixture-pc': {host: {resolution: '3840:2160', bitrate: 80}}}});
    assert.strictEqual(result.args[A.width], '1920');
    assert.strictEqual(result.args[A.height], '1080');
    assert.strictEqual(result.args[A.bitrate], '80000');
    assert(result.stages.some(text => text.includes('This TV cannot show the profile resolution')), JSON.stringify(result.stages));
  }
  console.log('stream_profiles_launch_test: v4.0.4-identical start without profile, game/PC priority, Play/Resume, HDR and panel rules, diagnosis config and no extra timers PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

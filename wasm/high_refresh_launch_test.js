'use strict';
// The production startGame with the experimental 120 FPS: 120 reaches the host and the player only
// on a panel measured near 120 Hz, anything else becomes 60 with a notice, and a 120 FPS start is
// guarded so an interrupted one returns to 60 next time. Other rates start exactly as before.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const prelude = fs.readFileSync('wasm/fixtures/app-lifecycle-prelude.js', 'utf8');
const sliceLauncher = text => text.slice(text.indexOf('function startGame('), text.indexOf('// Stop the running app title'));
const current = sliceLauncher(fs.readFileSync('wasm/platform/index.js', 'utf8'));
const profiles = ['stream-profiles.js', 'stream-profile-menu.js'].map(file => fs.readFileSync('wasm/platform/' + file, 'utf8')).join('\n');
const highRefresh = fs.readFileSync('wasm/platform/high-refresh.js', 'utf8');
const h = {require, console};
vm.createContext(h);
vm.runInContext(prelude + '\nglobalThis.make=fixture;globalThis.launch=realLauncher;', h);
const KEY = 'vibelight.high-refresh.pending';

async function run(options = {}) {
  const f = h.make();
  const r = h.launch(f, 'none', false, current);
  const c = f.c, launches = [], notices = [];
  c.StreamStartup = {begin() {}, finish() {}, cover() {}, native() {}, active: () => true, failure: () => '', stage() {}};
  c.maxSupportedWidth = 3840;
  c.getDisplayRefreshRateX100 = rate => options.measured || rate * 100;
  c.SessionDiagnostics.configure = () => {};
  c.snackbarLog = c.snackbarLogLong = text => notices.push(text);
  c.window = c.window || c;
  if (options.measured !== undefined) c.window._mlDisplayRefreshX100 = options.measured;
  const original = c.$;
  c.$ = Object.assign(selector => {
    const node = original(selector);
    if (selector === '#selectFramerate' && options.rate !== undefined) node.data = () => options.rate;
    return node;
  }, original);   // keeps statics such as $.parseXML
  if (options.module !== false) vm.runInContext(highRefresh, c);
  if (options.profile) {
    vm.runInContext(profiles, c);
    assert(c.StreamProfiles.setHost('fixture-pc', options.profile));
  }
  const base = f.host.launchApp;
  f.host.launchApp = f.host.resumeApp = (...args) => { launches.push(args); return base(); };
  c.startGame(f.host, 2);
  await f.flush();
  const start = r.calls.find(x => x && x.kind === 'startRequest');
  assert(start, 'the stream request is sent');
  const plain = value => JSON.parse(JSON.stringify(value === undefined ? null : value));
  return {fps: String(start.args[4]), mode: String(launches[0] && launches[0][1]), notices: plain(notices),
    armed: c.localStorage.getItem(KEY), refreshArg: start.args.length};
}

(async () => {
  // A panel measured at 120 Hz: 120 goes to the host (mode) and to the player, and the start is guarded.
  {
    const result = await run({rate: '120', measured: 12000});
    assert.strictEqual(result.fps, '120');
    assert(result.mode.endsWith('x120'), 'the launch request asks the host for 120: ' + result.mode);
    assert.strictEqual(result.armed, '1', 'guard armed before the start');
    assert.deepStrictEqual(result.notices, []);
  }
  // A 60 Hz or unmeasured panel never gets 120: the stream starts at 60, with a notice, without a guard.
  for (const measured of [6000, 5994, undefined, 0]) {
    const result = await run({rate: '120', measured});
    assert.strictEqual(result.fps, '60', 'measured ' + measured);
    assert(result.mode.endsWith('x60'));
    assert.strictEqual(result.armed, null);
    assert.strictEqual(result.notices.length, 1, 'the user is told');
  }
  // Other rates start exactly as before, on any panel, with no guard and no notice.
  for (const rate of ['30', '60', 30, 60]) for (const measured of [12000, 6000, undefined]) {
    const result = await run({rate, measured});
    assert.strictEqual(result.fps, String(rate));
    assert.strictEqual(result.armed, null);
    assert.deepStrictEqual(result.notices, []);
  }
  // A profile's own frame rate wins over a Settings 120, so no guard and nothing to say.
  {
    const result = await run({rate: '120', measured: 12000, profile: {frameRate: '30'}});
    assert.strictEqual(result.fps, '30');
    assert.strictEqual(result.armed, null);
    assert.deepStrictEqual(result.notices, []);
  }
  // Without the module the launcher is unchanged.
  {
    const result = await run({rate: '60', module: false});
    assert.strictEqual(result.fps, '60');
    assert.strictEqual(result.armed, null);
    const missing = await run({rate: '120', measured: 12000, module: false});
    assert.strictEqual(missing.fps, '120', 'no rules available: the chosen value is passed as before');
  }
  console.log('high_refresh_launch_test: 120 only on a measured 120 Hz panel, otherwise 60 with a notice, guarded start, other rates unchanged PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

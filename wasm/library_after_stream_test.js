'use strict';
// Back in the library after a stream: if the first check of the PC fails (the host may still be closing
// the session), it checks once more a few seconds later before saying the PC is unavailable. Real
// stream-end handler and library with a synthetic PC. Independent of the other stream tests.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const {setup} = require('./fixtures/host-availability.cjs');
const native = fs.readFileSync('wasm/main.cpp', 'utf8');
const afterStop = native.slice(native.indexOf('  // Last instance access:'));
const bridge = afterStop.match(/m_StopComplete\.store\(true[^;]+;\s*MAIN_THREAD_ASYNC_EM_ASM\(\{([\s\S]*?)\n  \}, generation\);/);
assert(bridge, 'native completion bridge');
const UNAVAILABLE = 'PC unavailable. Turn it on or use Wake PC, then use Refresh PC and library.';

function fixture() {
  const f = setup(), c = f.c, events = {};
  f.stopping = false; f.starts = [];
  c.Module = {sessionGeneration: 1, isStreamStopping: () => f.stopping};
  c.document.addEventListener = (name, fn) => { events[name] = fn; };
  c.SessionDiagnostics = {finish() {}}; c.stopVideoPresentationObserver = () => {}; c.Navigation.switch = () => {};
  const query = c.$;
  c.$ = value => typeof value === 'string' && value.startsWith('<') ? query(value) : {
    children() { return this; }, show() { return this; }, hide() { return this; }, css() { return this; }, removeClass() { return this; }, prop() { return false; }};
  c.$.parseXML = value => value;
  c.showApps = host => c.ConsoleLibrary.open(host);
  vm.runInContext(fs.readFileSync('wasm/platform/app-lifecycle.js', 'utf8'), c);
  const transport = c.sendMessage;
  vm.runInContext(fs.readFileSync('wasm/platform/messages.js', 'utf8'), c);
  c.sendMessage = transport;
  c.stopAudioScheduler = () => {}; c.prepareStreamAudio = () => {}; c.snackbarLog = () => {}; c.snackbarLogLong = () => {};
  c.startGame = (...args) => { f.starts.push(args); c.isInGame = true; c.ConsoleLibrary.suspend(); };
  f.finish = () => { f.stopping = false; c.$0 = c.Module.sessionGeneration; vm.runInContext(bridge[1], c); };
  f.exit = () => {
    c.ConsoleLibrary.suspend(); c.isInGame = true; f.stopping = true;
    c.handleMessage('streamTerminated: 0');
    const entry = [...f.timers].find(([, t]) => t.ms === 1500); if (entry) { f.timers.delete(entry[0]); entry[1].fn(); }
  };
  f.fire = async ms => { const entry = [...f.timers].find(([, t]) => t.ms === ms); assert(entry, 'timer ' + ms); f.timers.delete(entry[0]); entry[1].fn(); await f.flush(); };
  f.retryTimers = () => [...f.timers].filter(([, t]) => t.ms === 4000).length;
  f.status = () => f.node('libraryStatus').textContent;
  return f;
}
// A game was started from the library, the PC answers, the stream ends.
async function played() {
  const f = fixture(); f.state = 'on'; await f.open();
  f.node('libraryPlay').click(); await f.flush();
  assert.strictEqual(f.starts.length, 1, 'the game started');
  return f;
}

(async () => {
  // The first check after the stream fails and the PC answers a few seconds later: no "unavailable".
  let f = await played();
  f.state = 'off'; f.exit(); f.finish(); await f.flush();
  assert.notStrictEqual(f.status(), UNAVAILABLE, 'not unavailable yet: one more check is coming');
  assert.strictEqual(f.status(), 'Checking PC...');
  assert.strictEqual(f.retryTimers(), 1, 'one retry is scheduled');
  f.state = 'on'; await f.fire(4000);
  assert.match(f.status(), /PC online/); assert(f.host.online && f.host._authenticatedOnline);
  assert.strictEqual(f.retryTimers(), 0);

  // Still unreachable at the retry: now it says so, and nothing keeps retrying.
  f = await played();
  f.state = 'off'; f.exit(); f.finish(); await f.flush();
  await f.fire(4000);
  assert.strictEqual(f.status(), UNAVAILABLE);
  assert.strictEqual(f.retryTimers(), 0, 'one retry only');

  // The first check works: no retry at all.
  f = await played();
  f.exit(); f.finish(); await f.flush();
  assert.match(f.status(), /PC online/); assert.strictEqual(f.retryTimers(), 0);

  // No stream before: a failed check never retries by itself (the library is menu-only).
  f = fixture(); f.state = 'off'; await f.open();
  assert.strictEqual(f.status(), UNAVAILABLE); assert.strictEqual(f.retryTimers(), 0);

  // The retry belongs to that visit: leaving the library cancels it.
  f = await played();
  f.state = 'off'; f.exit(); f.finish(); await f.flush();
  assert.strictEqual(f.retryTimers(), 1);
  f.c.ConsoleLibrary.suspend();
  assert.strictEqual(f.retryTimers(), 0, 'no retry after leaving');

  // After the wake wait the PC is marked and shown as on before the game starts.
  f = fixture(); f.state = 'off'; await f.open();
  Object.assign(f.host, {macAddress: '12:34:56:78:9A:BC'}); f.host.sendWOL = () => Promise.resolve('sent');
  vm.runInContext(fs.readFileSync('wasm/platform/wake-and-play.js', 'utf8'), f.c);
  f.c.Views.UtilityDialog = {controls: []}; f.c.openUtilityDialog = () => { f.c.isDialogOpen = true; }; f.c.closeUtilityDialog = () => { f.c.isDialogOpen = false; };
  f.c.localStorage.setItem('vibelight.wake-play.policy', 'wake');
  let statusAtStart = null; const start = f.c.startGame;
  f.c.startGame = (...args) => { statusAtStart = f.status(); start(...args); };
  f.state = 'on'; f.node('libraryPlay').click(); await f.flush(); await f.fire(4000);
  assert.strictEqual(f.starts.length, 1);
  assert.match(statusAtStart, /PC online/, 'the status says the PC is on when the game starts');

  console.log('library_after_stream_test: one more check after a stream before "PC unavailable", and the PC shown on before the wake start PASS');
})().catch(error => { console.error(error); process.exit(1); });

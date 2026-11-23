'use strict';
// Resume after a connection drop: real stream-end handler, library and rules, with a synthetic PC and
// native completion. A network or video drop resumes the same game once the PC confirms it is still
// running; everything else ends as before. Independent of the other stream tests.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const {setup} = require('./fixtures/host-availability.cjs');
const native = fs.readFileSync('wasm/main.cpp', 'utf8');
const afterStop = native.slice(native.indexOf('  // Last instance access:'));
const bridge = afterStop.match(/m_StopComplete\.store\(true[^;]+;\s*MAIN_THREAD_ASYNC_EM_ASM\(\{([\s\S]*?)\n  \}, generation\);/);
assert(bridge, 'native completion bridge');
const KEY = 'vibelight.resume-on-drop';

function fixture(options = {}) {
  const f = setup(), c = f.c, events = {};
  f.stopping = false; f.gameRunning = true;
  Object.assign(f, {starts: [], released: [], kept: 0, messages: [], longMessages: []});
  c.Module = {sessionGeneration: 1, isStreamStopping: () => f.stopping};
  c.document.addEventListener = (name, fn) => { events[name] = fn; };
  c.SessionDiagnostics = {finish() {}};
  c.stopVideoPresentationObserver = () => {};
  c.Navigation.switch = () => {};
  const query = c.$;
  c.$ = value => typeof value === 'string' && value.startsWith('<') ? query(value) : {
    children() { return this; }, show() { return this; }, hide() { return this; }, css() { return this; }, removeClass() { return this; }, prop() { return false; }};
  c.$.parseXML = value => value;
  c.showApps = host => c.ConsoleLibrary.open(host);
  vm.runInContext(fs.readFileSync('wasm/platform/app-lifecycle.js', 'utf8'), c);
  const transport = c.sendMessage;
  // The PC reports a busy server running game 1 while f.gameRunning is true.
  const wrapped = (name, args) => transport(name, args).then(reply =>
    typeof reply === 'string' && f.gameRunning && args[0].includes('/serverinfo?') ? reply.replace('</root>', '<state>SUNSHINE_SERVER_BUSY</state><currentgame>1</currentgame></root>') : reply);
  vm.runInContext(fs.readFileSync('wasm/platform/messages.js', 'utf8'), c);
  c.sendMessage = wrapped; // messages.js defines its own transport; keep the synthetic PC
  vm.runInContext(fs.readFileSync('wasm/platform/resume-on-drop.js', 'utf8'), c);
  c._mlAudioCtx = options.audio === false ? null : {state: options.audio || 'running'};
  c.stopAudioScheduler = close => { if (close) f.released.push(1); else f.kept++; };
  c.snackbarLog = m => f.messages.push(m);
  c.snackbarLogLong = m => f.longMessages.push(m);
  c.prepareStreamAudio = () => { throw new Error('an automatic resume must not create an AudioContext'); };
  c.startGame = (...args) => { f.starts.push(args); c.isInGame = true; c.ConsoleLibrary.suspend(); };
  f.finish = () => { f.stopping = false; f.state = 'on'; c.$0 = c.Module.sessionGeneration; vm.runInContext(bridge[1], c); };
  // A game was launched from the library, then the stream ends with `code`.
  f.launch = () => { c.ResumeOnDrop.noteLaunch(f.host, 1, Date.now(), false); };
  f.drop = code => {
    c.ConsoleLibrary.suspend(); c.isInGame = true; f.stopping = true;
    c.handleMessage('streamTerminated: ' + code);
    const entry = [...f.timers].find(([, t]) => t.ms === 1500); if (entry) { f.timers.delete(entry[0]); entry[1].fn(); }
  };
  return f;
}
async function started(options) { const f = fixture(options); f.state = 'on'; await f.open(); f.launch(); return f; }
const count = f => f.starts.length;

(async () => {
  // A network drop: the audio context is kept, the user is told, and once the PC confirms the game
  // is still running it resumes that game once, with the kept audio and no new AudioContext.
  let f = await started();
  f.drop(-101);
  assert.strictEqual(f.kept, 1, 'audio context kept for the resume'); assert.deepStrictEqual(f.released, []);
  assert(f.messages.some(m => /Connection lost\. Resuming the game/.test(m)), 'tells the user at once');
  assert.strictEqual(count(f), 0, 'waits for the end of the native cleanup and for the PC');
  f.finish(); await f.flush();
  assert.strictEqual(count(f), 1, 'the game resumes once');
  assert.strictEqual(f.starts[0][0], f.host); assert.strictEqual(f.starts[0][1], 1); assert.strictEqual(f.starts[0][2], true, 'with the kept audio');
  assert.deepStrictEqual(f.released, [], 'the kept audio is handed to the new stream');

  // Other connection drops (generic termination, no video traffic) qualify too.
  for (const code of [-100, -7]) { f = await started(); f.drop(code); f.finish(); await f.flush(); assert.strictEqual(count(f), 1, 'drop ' + code); }

  // Not a drop, or not wanted: as before (audio closed, no resume).
  for (const [label, run] of [
    ['graceful end', async () => { const x = await started(); x.drop(0); return x; }],
    ['host error', async () => { const x = await started(); x.drop(-103); return x; }],
    ['setting off', async () => { const x = fixture(); x.state = 'on'; await x.open(); x.c.localStorage.setItem(KEY, '0'); x.launch(); x.drop(-101); return x; }],
    ['no audio context', async () => { const x = await started({audio: false}); x.drop(-101); return x; }],
    ['closed audio context', async () => { const x = await started({audio: 'closed'}); x.drop(-101); return x; }],
  ]) {
    f = await run(); f.finish(); await f.flush();
    assert.strictEqual(count(f), 0, label + ': nothing resumes');
    assert.strictEqual(f.kept, 0, label + ': audio closed as before');
    assert(!f.messages.some(m => /Resuming/.test(m)), label + ': no resume message');
  }

  // The PC no longer runs the game: a short message, the library as usual, the audio given back.
  f = await started(); f.gameRunning = false;
  f.drop(-101); f.finish(); await f.flush();
  assert.strictEqual(count(f), 0);
  assert.strictEqual(f.released.length, 1, 'kept audio released');
  assert(f.messages.some(m => /could not be resumed/.test(m)));

  // The PC does not answer: same.
  f = await started();
  f.drop(-101); f.finish(); f.state = 'off'; await f.flush();
  assert.strictEqual(count(f), 0); assert.strictEqual(f.released.length, 1);
  assert(f.messages.some(m => /could not be resumed/.test(m)));

  // Leaving the library before the PC answers cancels the resume.
  f = await started();
  f.drop(-101); f.c.ConsoleLibrary.hide(); f.finish(); await f.flush();
  assert.strictEqual(count(f), 0); assert.strictEqual(f.released.length, 1);

  // A manual Play while it waits takes over (no automatic start).
  f = await started();
  f.drop(-101); f.c.ConsoleLibrary.accept(); f.finish(); await f.flush();
  assert.strictEqual(count(f), 1, 'only the manual start'); assert.strictEqual(f.starts[0][2], false);

  // At most 3 automatic resumes in a row.
  f = await started();
  for (let i = 1; i <= 3; i++) { f.drop(-101); f.finish(); await f.flush(); assert.strictEqual(count(f), i, 'resume ' + i); f.c.isInGame = false; }
  f.drop(-101); f.finish(); await f.flush();
  assert.strictEqual(count(f), 3, 'the 4th drop does not resume');
  assert.strictEqual(f.kept, 3); assert.strictEqual(f.released.length, 1, 'audio closed once the limit is reached');

  console.log('resume_on_drop_library_test: drops resume once, other endings and failures end as before PASS');
})().catch(error => { console.error(error); process.exit(1); });

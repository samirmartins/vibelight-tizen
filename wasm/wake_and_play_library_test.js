'use strict';
// Wake and play in the library: Play on a PC found off offers to wake it, waits for it and starts
// the game. Real library code in the library fixture; the PC, clock and audio are controlled here.
// Independent of the older wake tests.
const assert = require('assert'), fs = require('fs');
const {fixture} = require('./fixtures/console-library.cjs');
const vm = require('vm');
const MAC = '12:34:56:78:9A:BC';
const POLICY = 'vibelight.wake-play.policy';

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; }
async function fire(f, ms) {
  const entry = [...f.timers].find(([, t]) => t.ms === ms);
  assert(entry, 'no timer of ' + ms + ' ms');
  f.timers.delete(entry[0]); entry[1].fn(); await f.flush();
}

// An offline PC with a MAC. `up()` brings it online the way a real Sunshine answer would.
async function setup(options = {}) {
  const f = fixture(2), c = f.c, h = f.host;
  vm.runInContext(fs.readFileSync('wasm/platform/wake-and-play.js', 'utf8'), c);
  Object.assign(h, {online: false, paired: true, ppkstr: 'synthetic pin', macAddress: options.mac === undefined ? MAC : options.mac});
  Object.assign(f, {launches: [], wakes: 0, audio: 0, released: 0, probes: 0, opened: [], openers: [], closed: [], messages: [], pcUp: false});
  h.connect = () => {
    f.probes++;
    if (f.probeGate) return f.probeGate.promise.then(() => { if (!f.pcUp) throw Error('offline'); h.online = true; h._authenticatedOnline = true; return 'fixture.invalid'; });
    if (!f.pcUp) return Promise.reject(Error('offline'));
    h.online = true; h._authenticatedOnline = true; return Promise.resolve('fixture.invalid');
  };
  h.sendWOL = () => { f.wakes++; return f.wakeGate ? f.wakeGate.promise : Promise.resolve('sent'); };
  c.startGame = (...args) => { f.launches.push(args); c.isInGame = true; c.ConsoleLibrary.suspend(); };
  c.prepareStreamAudio = () => { f.audio++; };
  c.stopAudioScheduler = (close) => { if (close) f.released++; };
  c.snackbarLog = (message) => f.messages.push(message);
  c.Views.UtilityDialog = {controls: []};
  c.openUtilityDialog = (id, controls, closeId, opener) => { f.opened.push(id); f.openers.push(opener); c.Views.UtilityDialog.controls = controls; c.isDialogOpen = true; };
  c.closeUtilityDialog = (id) => { f.closed.push(id); c.isDialogOpen = false; };
  if (options.policy) c.localStorage.setItem(POLICY, options.policy);
  if (options.hangFirst) { // the very first check never finishes
    f.infoGate = deferred(); h.connect = () => f.infoGate.promise;
    f.opening = f.c.ConsoleLibrary.open(h); await f.flush();
    return f;
  }
  await f.open();
  assert.strictEqual(f.host.online, false, 'the check found the PC off');
  return f;
}
const text = (f, name) => f.node(name).textContent;

(async () => {
  // PC on: Play is exactly what it was.
  let f = await setup();
  f.pcUp = true; f.host.online = true; f.host._authenticatedOnline = true;
  await f.c.ConsoleLibrary.open(f.host); await f.flush();
  f.node('libraryPlay').click(); await f.flush();
  assert.strictEqual(f.launches.length, 1); assert.strictEqual(f.launches[0][2], false);
  assert.deepStrictEqual(f.opened, []); assert.strictEqual(f.wakes, 0); assert.strictEqual(f.audio, 0);

  // PC off but no MAC to wake: Play is what it was (no dialog).
  f = await setup({mac: ''});
  f.node('libraryPlay').click(); await f.flush();
  assert.strictEqual(f.launches.length, 1); assert.deepStrictEqual(f.opened, []); assert.strictEqual(f.wakes, 0);

  // Policy "never": Play is what it was.
  f = await setup({policy: 'never'});
  f.node('libraryPlay').click(); await f.flush();
  assert.strictEqual(f.launches.length, 1); assert.deepStrictEqual(f.opened, []); assert.strictEqual(f.wakes, 0);

  // The very first check is still running: nothing proves the PC is off, so Play starts as before.
  f = await setup({hangFirst: true});
  f.node('libraryPlay').click(); f.infoGate.reject(Error('late')); await f.opening; await f.flush();
  assert.strictEqual(f.launches.length, 1); assert.deepStrictEqual(f.opened, []);

  // The PC was found off and the library checks again (coming back from Settings, a refresh): while the
  // new check runs, the last answer still counts, so the setting is honoured and Play asks. Before, the
  // new check made Play start the game anyway, as if "Ask" were not set.
  f = await setup();
  f.infoGate = deferred(); f.host.connect = () => f.infoGate.promise;
  const reopening = f.c.ConsoleLibrary.open(f.host); await f.flush();
  f.node('libraryPlay').click(); await f.flush();
  assert.deepStrictEqual(f.opened, ['wakePlayDialog'], 'asks while the new check runs');
  assert.strictEqual(f.launches.length, 0);
  f.node('wakePlayCancel').click(); f.infoGate.reject(Error('late')); await reopening; await f.flush();

  // The PC answered the last check: Play starts directly even while a new check runs.
  f = await setup(); f.pcUp = true;
  await f.c.ConsoleLibrary.open(f.host); await f.flush();
  assert.strictEqual(f.host.online, true);
  f.infoGate = deferred(); f.host.connect = () => f.infoGate.promise;
  const again = f.c.ConsoleLibrary.open(f.host); await f.flush();
  f.node('libraryPlay').click(); f.infoGate.reject(Error('late')); await again; await f.flush();
  assert.strictEqual(f.launches.length, 1); assert.deepStrictEqual(f.opened, [], 'a PC found on is not asked about');

  // Changing the setting takes effect at once: Never starts the game, Ask asks again, with the same last answer.
  f = await setup({policy: 'never'});
  f.infoGate = deferred(); f.host.connect = () => f.infoGate.promise;
  const settingTest = f.c.ConsoleLibrary.open(f.host); await f.flush();
  f.node('libraryPlay').click(); await f.flush();
  assert.strictEqual(f.launches.length, 1, 'Just try to play starts the game'); f.infoGate.reject(Error('x')); await settingTest;

  // PC off, MAC known, default policy: Play asks. Nothing is sent, started or prepared yet.
  f = await setup();
  f.node('libraryPlay').click(); await f.flush();
  assert.deepStrictEqual(f.opened, ['wakePlayDialog']);
  assert.deepStrictEqual(Array.from(f.c.Views.UtilityDialog.controls), ['wakePlayWake', 'wakePlayTry', 'wakePlayCancel', 'wakePlayRemember'], 'buttons first, the checkbox below them');
  assert.strictEqual(f.node('wakePlayRememberRow').style.display, '', 'the checkbox is shown with the question');
  assert.strictEqual(f.node('wakePlayRemember').checked, false, 'unchecked by default');
  assert.strictEqual(f.launches.length, 0); assert.strictEqual(f.wakes, 0); assert.strictEqual(f.audio, 0);
  assert(/Wake-on-LAN/.test(text(f, 'wakePlayNote')), 'a short note that the PC must be set up for Wake-on-LAN');
  assert.strictEqual(f.openers[0], 'game-container-1', 'focus returns to the chosen game card, not the Play button');
  // Cancel: nothing sent, nothing started, nothing remembered.
  f.node('wakePlayCancel').click(); await f.flush();
  assert.deepStrictEqual(f.closed, ['wakePlayDialog']);
  assert.strictEqual(f.launches.length, 0); assert.strictEqual(f.wakes, 0); assert.strictEqual(f.audio, 0);
  assert.strictEqual(f.storage.get(POLICY), undefined); assert.strictEqual(f.timers.size, 0);

  // "Just try to play": no wake, the game starts as it always did.
  f = await setup();
  f.node('libraryPlay').click(); await f.flush(); f.node('wakePlayTry').click(); await f.flush();
  assert.deepStrictEqual(f.closed, ['wakePlayDialog']);
  assert.strictEqual(f.launches.length, 1); assert.strictEqual(f.launches[0][2], false); assert.strictEqual(f.wakes, 0);

  // "Wake and play": audio is prepared in that click, one packet is sent, then the PC is checked
  // every 4 s; once it answers the game starts once, with the prepared audio.
  f = await setup();
  f.node('libraryPlay').click(); await f.flush();
  f.node('wakePlayWake').click(); await f.flush();
  assert.strictEqual(f.audio, 1, 'audio prepared inside the confirming click');
  assert.strictEqual(f.wakes, 1);
  assert.deepStrictEqual(Array.from(f.c.Views.UtilityDialog.controls), ['wakePlayCancel'], 'only Cancel while waiting');
  assert.strictEqual(f.node('wakePlayRememberRow').style.display, 'none', 'no checkbox while waiting');
  assert.strictEqual(f.launches.length, 0);
  const probes0 = f.probes;
  await fire(f, 4000); assert.strictEqual(f.probes, probes0 + 1); assert.strictEqual(f.launches.length, 0, 'PC still off');
  f.pcUp = true;
  await fire(f, 4000);
  assert.strictEqual(f.launches.length, 1, 'the game starts once the PC answers');
  assert.strictEqual(f.launches[0][1], 1); assert.strictEqual(f.launches[0][2], true, 'with the audio prepared in the click');
  assert.strictEqual(f.wakes, 1); assert.strictEqual(f.released, 0);
  assert.deepStrictEqual(f.closed, ['wakePlayDialog']);
  assert.strictEqual(f.timers.size, [...f.timers].filter(([, t]) => t.ms === 2000).length, 'no wake timer left running');

  // The PC never comes up: after 120 s the wait ends, the audio is released, the user is told.
  f = await setup();
  f.node('libraryPlay').click(); await f.flush(); f.node('wakePlayWake').click(); await f.flush();
  assert.strictEqual(f.openers[0], 'game-container-1');
  await fire(f, 120000);
  assert.strictEqual(f.launches.length, 0); assert.strictEqual(f.released, 1, 'prepared audio released');
  assert.deepStrictEqual(f.closed, ['wakePlayDialog']);
  assert(f.messages.some(m => /did not respond/.test(m)) || /did not respond/.test(text(f, 'libraryStatus')));
  assert(/Wake-on-LAN/.test(text(f, 'libraryStatus')) || f.messages.some(m => /Wake-on-LAN/.test(m)), 'points at the PC setup');
  assert.strictEqual([...f.timers].filter(([, t]) => t.ms === 4000).length, 0);
  const probes1 = f.probes; f.pcUp = true; await f.flush(); assert.strictEqual(f.probes, probes1, 'no check after the end');

  // Cancel while waiting: stops, releases the audio, a late answer starts nothing.
  f = await setup(); f.probeGate = deferred();
  f.node('libraryPlay').click(); await f.flush(); f.node('wakePlayWake').click(); await f.flush();
  await fire(f, 4000);
  f.node('wakePlayCancel').click(); await f.flush();
  assert.strictEqual(f.released, 1); assert.deepStrictEqual(f.closed, ['wakePlayDialog']);
  f.pcUp = true; f.probeGate.resolve(); await f.flush();
  assert.strictEqual(f.launches.length, 0); assert.strictEqual(f.wakes, 1);
  assert.strictEqual([...f.timers].filter(([, t]) => t.ms === 4000 || t.ms === 120000).length, 0);

  // The wake packet cannot be sent: say so, release the audio, do not start.
  f = await setup(); f.wakeGate = deferred();
  f.node('libraryPlay').click(); await f.flush(); f.node('wakePlayWake').click(); f.wakeGate.reject(Error('synthetic')); await f.flush();
  assert.strictEqual(f.launches.length, 0); assert.strictEqual(f.released, 1);
  assert(f.messages.some(m => /Could not send Wake-on-LAN/.test(m)));

  // Play pressed again while waiting does nothing more (one wait, one packet, one start).
  f = await setup();
  f.node('libraryPlay').click(); await f.flush(); f.node('wakePlayWake').click(); await f.flush();
  f.node('libraryPlay').click(); await f.flush(); f.c.ConsoleLibrary.accept(); await f.flush();
  assert.strictEqual(f.wakes, 1); assert.strictEqual(f.audio, 1); assert.deepStrictEqual(f.opened, ['wakePlayDialog']);
  f.pcUp = true; await fire(f, 4000);
  assert.strictEqual(f.launches.length, 1);

  // Leaving the library while waiting ends the wait without starting anything.
  f = await setup();
  f.node('libraryPlay').click(); await f.flush(); f.node('wakePlayWake').click(); await f.flush();
  f.c.ConsoleLibrary.suspend(); await f.flush();
  assert.strictEqual(f.released, 1); f.pcUp = true;
  assert.strictEqual([...f.timers].filter(([, t]) => t.ms === 4000 || t.ms === 120000).length, 0);
  assert.strictEqual(f.launches.length, 0);

  // Remember: the toggle shows its state; with "Wake and play" the choice becomes "wake" and the
  // next Play skips the question (audio prepared in that Play click, packet sent, waiting).
  f = await setup();
  f.node('libraryPlay').click(); await f.flush();
  assert.strictEqual(f.node('wakePlayRemember').checked, false);
  f.node('wakePlayRemember').checked = true; // the user ticks the box
  f.node('wakePlayWake').click(); await f.flush();
  assert.strictEqual(f.storage.get(POLICY) || f.writes.filter(w => w.key === POLICY).pop().value, 'wake');
  f.node('wakePlayCancel').click(); await f.flush();
  f.opened.length = 0; f.openers.length = 0; f.audio = 0; f.wakes = 0;
  f.node('libraryPlay').click(); await f.flush();
  assert.deepStrictEqual(f.opened, ['wakePlayDialog'], 'only the waiting view opens, no question');
  assert.deepStrictEqual(f.openers, ['game-container-1'], 'the waiting view also returns to the game card');
  assert.deepStrictEqual(Array.from(f.c.Views.UtilityDialog.controls), ['wakePlayCancel']);
  assert.strictEqual(f.audio, 1); assert.strictEqual(f.wakes, 1);
  f.pcUp = true; await fire(f, 4000);
  assert.strictEqual(f.launches.length, 1); assert.strictEqual(f.launches[0][2], true);

  // Remember with "Just try": the choice becomes "never"; Cancel never remembers.
  f = await setup();
  f.node('libraryPlay').click(); await f.flush(); f.node('wakePlayRemember').checked = true; f.node('wakePlayCancel').click(); await f.flush();
  assert(!f.writes.some(w => w.key === POLICY), 'cancel remembers nothing');
  f.node('libraryPlay').click(); await f.flush();
  assert.strictEqual(f.node('wakePlayRemember').checked, false, 'the box starts unchecked each time');
  f.node('wakePlayRemember').checked = true; f.node('wakePlayTry').click(); await f.flush();
  assert.strictEqual(f.writes.filter(w => w.key === POLICY).pop().value, 'never');

  console.log('wake_and_play_library_test: OK');
})().catch(error => { console.error(error); process.exit(1); });

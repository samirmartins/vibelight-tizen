'use strict';
// Wake and play, the wait: one wake packet, then a check every few seconds up to a limit. Fake
// clock and fake PC; independent of the older wake tests.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const context = vm.createContext({String, Number, Math, Promise, Error});
vm.runInContext(fs.readFileSync('wasm/platform/wake-and-play.js', 'utf8'), context);
const api = context.WakeAndPlay;

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; }
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

// A clock that runs timers in order; time only moves when the test advances it.
function clock() {
  let now = 0, serial = 0;
  const timers = new Map();
  return {
    timers,
    now: () => now,
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, {at: now + ms, fn, id}); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      await flush();
      const end = now + ms;
      for (;;) {
        const due = [...timers.values()].filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers.delete(due.id); now = due.at; due.fn(); await flush();
      }
      now = end; await flush();
    },
  };
}

function start(options = {}) {
  const c = clock(), log = {sends: 0, probes: 0, progress: []};
  const pc = {ready: false, probeGate: null, sendGate: options.sendGate || null};
  const handle = api.wait({
    send() { log.sends++; return pc.sendGate ? pc.sendGate.promise : Promise.resolve('sent'); },
    probe() {
      log.probes++;
      if (pc.probeGate) return pc.probeGate.promise;
      if (pc.probeError) return Promise.reject(new Error('offline'));
      return Promise.resolve(pc.ready);
    },
    setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, now: c.now,
    intervalMs: options.intervalMs, limitMs: options.limitMs,
    onProgress(elapsed) { log.progress.push(elapsed); },
  });
  let outcome = null;
  handle.promise.then(value => { outcome = value; });
  return {c, log, pc, handle, result: () => outcome};
}

(async () => {
  // Defaults: a check every 4 s for up to 120 s.
  assert.strictEqual(api.INTERVAL_MS, 4000);
  assert.strictEqual(api.LIMIT_MS, 120000);

  // The PC comes up: one wake packet, checks 4 s apart, the wait ends on the first good answer.
  let t = start();
  await flush();
  assert.strictEqual(t.log.sends, 1, 'one wake packet at the start');
  assert.strictEqual(t.log.probes, 0, 'no check before the first interval');
  await t.c.advance(3999); assert.strictEqual(t.log.probes, 0);
  await t.c.advance(1); assert.strictEqual(t.log.probes, 1);
  await t.c.advance(4000); assert.strictEqual(t.log.probes, 2);
  assert.strictEqual(t.result(), null, 'still waiting while the PC does not answer');
  t.pc.ready = true;
  await t.c.advance(4000);
  assert.strictEqual(t.log.probes, 3);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.result())), {result: 'ready', elapsedMs: 12000});
  assert.strictEqual(t.log.sends, 1, 'the packet is never repeated');
  assert.strictEqual(t.c.timers.size, 0, 'no timer survives the end of the wait');
  await t.c.advance(60000); assert.strictEqual(t.log.probes, 3, 'no check after the end');
  assert.deepStrictEqual(t.log.progress, [0, 4000, 8000, 12000]);

  // The limit: the PC never answers; the wait stops by itself and nothing is left running.
  t = start();
  await t.c.advance(119999);
  assert.strictEqual(t.result(), null);
  await t.c.advance(1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.result())), {result: 'timeout', elapsedMs: 120000});
  assert.strictEqual(t.log.probes, 29, 'checks at 4 s .. 116 s only');
  assert.strictEqual(t.c.timers.size, 0);
  await t.c.advance(60000); assert.strictEqual(t.log.probes, 29);

  // Other values are honoured.
  t = start({intervalMs: 1000, limitMs: 3500});
  await t.c.advance(10000);
  assert.strictEqual(t.result().result, 'timeout'); assert.strictEqual(t.log.probes, 3);

  // Cancelling between checks stops everything.
  t = start();
  await t.c.advance(8000);
  t.handle.cancel(); await flush();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.result())), {result: 'cancelled', elapsedMs: 8000});
  assert.strictEqual(t.c.timers.size, 0);
  await t.c.advance(200000); assert.strictEqual(t.log.probes, 2); assert.strictEqual(t.log.sends, 1);
  t.handle.cancel(); // a second cancel is harmless

  // Cancelling during a check: a late "PC is up" answer must not start anything.
  t = start(); t.pc.probeGate = deferred();
  await t.c.advance(4000); assert.strictEqual(t.log.probes, 1);
  t.handle.cancel(); await flush();
  assert.strictEqual(t.result().result, 'cancelled');
  t.pc.probeGate.resolve(true); await flush();
  assert.strictEqual(t.result().result, 'cancelled', 'a late answer after cancel changes nothing');
  assert.strictEqual(t.c.timers.size, 0);

  // A slow check never overlaps the next one: the next waits a full interval after the answer.
  t = start(); t.pc.probeGate = deferred();
  await t.c.advance(4000); await t.c.advance(10000);
  assert.strictEqual(t.log.probes, 1, 'no second check while the first is pending');
  t.pc.probeGate.resolve(false); t.pc.probeGate = null; await flush();
  await t.c.advance(3999); assert.strictEqual(t.log.probes, 1);
  await t.c.advance(1); assert.strictEqual(t.log.probes, 2);
  t.handle.cancel();

  // A check that outlives the limit still ends the wait on time, and its late answer is ignored.
  t = start(); t.pc.probeGate = deferred();
  await t.c.advance(4000); await t.c.advance(116000);
  assert.strictEqual(t.result().result, 'timeout'); assert.strictEqual(t.result().elapsedMs, 120000);
  t.pc.probeGate.resolve(true); await flush();
  assert.strictEqual(t.result().result, 'timeout');

  // A failing check counts as "not yet" and the wait goes on.
  t = start(); t.pc.probeError = true;
  await t.c.advance(12000); assert.strictEqual(t.log.probes, 3); assert.strictEqual(t.result(), null);
  t.pc.probeError = false; t.pc.ready = true;
  await t.c.advance(4000); assert.strictEqual(t.result().result, 'ready');

  // The packet cannot be sent: stop at once, no checks.
  t = start();
  t = (function() { // a send that fails
    const c = clock(), log = {probes: 0};
    const handle = api.wait({send: () => Promise.reject(new Error('no network')), probe: () => { log.probes++; return Promise.resolve(true); },
      setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, now: c.now});
    let outcome = null; handle.promise.then(v => { outcome = v; });
    return {c, log, handle, result: () => outcome};
  })();
  await flush();
  assert.strictEqual(t.result().result, 'send-failed');
  assert.strictEqual(t.c.timers.size, 0);
  await t.c.advance(200000); assert.strictEqual(t.log.probes, 0);

  // A packet that never leaves does not hang the wait: the limit ends it, and cancel works too.
  t = start({sendGate: deferred()});
  await t.c.advance(8000); assert.strictEqual(t.log.probes, 0, 'no checks before the packet is sent');
  t.pc.sendGate.resolve('sent'); await flush();
  await t.c.advance(4000); assert.strictEqual(t.log.probes, 1);
  t.handle.cancel();
  t = start({sendGate: deferred()});
  await t.c.advance(200000); assert.strictEqual(t.result().result, 'timeout');
  t = start({sendGate: deferred()});
  t.handle.cancel(); await flush(); assert.strictEqual(t.result().result, 'cancelled');
  t.pc.sendGate.resolve('sent'); await flush(); await t.c.advance(20000);
  assert.strictEqual(t.log.probes, 0, 'a packet confirmed after cancel starts no checks');

  console.log('wake_and_play_wait_test: OK');
})().catch(error => { console.error(error); process.exit(1); });

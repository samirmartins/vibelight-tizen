'use strict';
// The 120 FPS guard is cleared when the stream connects or the user cancels the start, and is left in
// place when a late or foreign connection message arrives (the start it belongs to did not finish).
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const highRefresh = fs.readFileSync('wasm/platform/high-refresh.js', 'utf8');
const KEY = 'vibelight.high-refresh.pending';
const prelude = fs.readFileSync('wasm/fixtures/app-lifecycle-prelude.js', 'utf8');
const h = {require, console};
vm.createContext(h);
vm.runInContext(prelude + '\nglobalThis.make=fixture;', h);

(async () => {
  // A connection of this session clears the guard; one that is not ours does not.
  {
    const f = h.make(); let connected = 0;
    f.c.SessionDiagnostics.connected = () => connected++;
    f.c.$ = () => ({children() { return this; }, show() { return this; }, hide() { return this; }, css() { return this; }, removeClass() { return this; }, focus() {}, prop() { return false; }});
    vm.runInContext(fs.readFileSync('wasm/platform/messages.js', 'utf8'), f.c);
    vm.runInContext(highRefresh, f.c);
    f.c.HighRefresh.arm(f.c.localStorage);
    f.c.isInGame = true; f.visibility(true);
    f.c.handleMessage('Connection Established');
    assert.strictEqual(f.c.localStorage.getItem(KEY), '1', 'a hidden or stale message leaves the guard');
    f.visibility(false); await f.flush();
    f.c.isInGame = false;
    f.c.handleMessage('Connection Established');
    assert.strictEqual(f.c.localStorage.getItem(KEY), '1', 'not in a game: not ours');
    f.c.isInGame = true;
    f.c.handleMessage('Connection Established');
    assert.strictEqual(connected, 1);
    assert.strictEqual(f.c.localStorage.getItem(KEY), null, 'connected: the start finished');
    // Without the module the message works as before.
    const g = h.make(); let n = 0;
    g.c.SessionDiagnostics.connected = () => n++;
    g.c.$ = f.c.$;
    vm.runInContext(fs.readFileSync('wasm/platform/messages.js', 'utf8'), g.c);
    g.c.isInGame = true;
    assert.doesNotThrow(() => g.c.handleMessage('Connection Established'));
    assert.strictEqual(n, 1);
  }
  // Cancelling the start clears it too: the user stopped it, nothing froze.
  {
    const nodes = {}, calls = [], store = new Map();
    const c = {Promise, api: {}, localStorage: {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)},
      document: {body: {classList: {add() {}, remove() {}}}, getElementById: id => nodes[id] || (nodes[id] = {style: {}, classList: {add() {}, remove() {}}, hidden: false, textContent: '', focus() {}})},
      showApps() { calls.push('library'); }, Module: {stopStream() { calls.push('native'); }}, snackbarLogLong() {}};
    vm.createContext(c);
    vm.runInContext(fs.readFileSync('wasm/platform/stream-startup.js', 'utf8'), c);
    vm.runInContext(highRefresh, c);
    c.HighRefresh.arm(c.localStorage);
    c.StreamStartup.begin(c.api, () => calls.push('cancel'));
    assert.strictEqual(c.localStorage.getItem(KEY), '1', 'starting does not clear it');
    c.StreamStartup.cancel();
    assert.strictEqual(c.localStorage.getItem(KEY), null, 'cancelled by the user');
    c.StreamStartup.cancel();   // idempotent
  }
  console.log('high_refresh_guard_test: connection and cancel clear the guard, stale messages leave it, no module needed PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

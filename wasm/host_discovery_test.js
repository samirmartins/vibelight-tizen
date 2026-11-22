'use strict';
// Finding a PC: its candidate addresses are probed one after the other with a short stagger (the preferred first),
// every probe may take up to one shared deadline, the first valid answer wins, and a PC that is alive but slow
// is found instead of being given up on after 4.5 s per address. Real NvHTTP.connect on a fake clock.
const assert = require('assert'), fs = require('fs'), vm = require('vm');

function world() {
  const timers = []; let now = 0, serial = 0;
  const requests = [];
  const c = {Promise, console: {log() {}, warn() {}, error() {}}, navigator: {}, isInGame: false, hosts: {},
    setTimeout(fn, ms) { const timer = {id: ++serial, due: now + (ms || 0), fn}; timers.push(timer); return timer.id; },
    clearTimeout(id) { const at = timers.findIndex(t => t.id === id); if (at >= 0) timers.splice(at, 1); },
    document: {getElementById: () => ({classList: {remove() {}}, style: {}})}, saveHosts() {}, updateHostStatusIndicator() {}};
  c.window = c; vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/menu-tools.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync('wasm/static/js/utils.js', 'utf8'), c);
  const xmlQuery = (xml, tag = 'root') => ({find: name => xmlQuery(xml, name),
    text() { const m = xml.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>')); return m ? m[1] : ''; }, html() { return this.text(); }, each() {}, attr: () => '200'});
  c.$ = xml => xmlQuery(xml); c.$.parseXML = xml => xml;
  const reply = uid => '<root status_code="200"><uniqueid>' + uid + '</uniqueid><hostname>pc</hostname><LocalIP>10.0.0.6</LocalIP><HttpsPort>47984</HttpsPort>' +
    '<appversion>7.1.431.-1</appversion><state>SUNSHINE_SERVER_BUSY</state><currentgame>5</currentgame><PairStatus>1</PairStatus><mac>12:34:56:78:9A:BC</mac></root>';
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      await flush();
      const next = timers.filter(t => t.due <= end).sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!next) break;
      timers.splice(timers.indexOf(next), 1); now = Math.max(now, next.due); next.fn();
    }
    now = end; await flush();
  }
  // behavior: address -> {after: ms, ok: true|false|'hang'|'other-pc'}
  function host(behavior) {
    const h = new c.NvHTTP('10.0.0.5', 'client'); h.serverUid = 'pc'; h.ppkstr = 'pinned'; h.paired = true; h.hostname = 'pc';
    h.httpPort = 47989; h.httpsPort = 47984; h.localAddress = '10.0.0.6'; h.userEnteredAddress = 'pc.lan'; h.externalIP = '203.0.113.9';
    h._parseXML = x => xmlQuery(x);
    c.sendMessage = (name, args) => {
      const address = args[0].match(/^https?:\/\/([^:/]+)/)[1];
      requests.push({address, at: now, timeout: args[3]});
      const rule = behavior[address] || {ok: 'hang'};
      if (rule.ok === 'hang') return new Promise(() => {});
      return new Promise((resolve, reject) => c.setTimeout(() => {
        if (rule.ok === false) reject(new Error('refused'));
        else resolve(reply(rule.ok === 'other-pc' ? 'someone-else' : 'pc'));
      }, rule.after || 0));
    };
    return h;
  }
  const outcome = promise => { const o = {done: false}; promise.then(v => { o.done = true; o.value = v; o.at = now; }, e => { o.done = true; o.error = e; o.at = now; }); return o; };
  return {c, host, advance, requests, outcome, now: () => now, timers};
}
const A = '10.0.0.5', B = '10.0.0.6', C = 'pc.lan', D = 'pc.local', E = '203.0.113.9';

(async () => {
  // A fast preferred address wins at once; later candidates are never even probed.
  {
    const w = world(), h = w.host({[A]: {ok: true, after: 100}});
    const o = w.outcome(h.connect(w.c.createMenuRequestScope()));
    await w.advance(2000);
    assert(o.done && o.value === A, 'resolved with the preferred address');
    assert.strictEqual(w.requests.length, 1, 'nobody else was asked');
    assert.strictEqual(w.timers.length, 0, 'no timer left behind');
  }
  // A PC that is alive but answers after 6 s (more than the old 4.5 s per address) is found.
  {
    const w = world(), h = w.host({[A]: {ok: true, after: 6000}});
    const o = w.outcome(h.connect(w.c.createMenuRequestScope()));
    await w.advance(6500);
    assert(o.done && o.value === A, 'a slow PC is found: ' + JSON.stringify(o.error && o.error.message));
    assert.strictEqual(h.online, true);
    assert.strictEqual(h.currentGame, 5);
  }
  // A dead first address does not make the others wait for its timeout.
  {
    const w = world(), h = w.host({[A]: {ok: 'hang'}, [B]: {ok: true, after: 50}});
    const o = w.outcome(h.connect(w.c.createMenuRequestScope()));
    await w.advance(1000);
    assert(o.done && o.value === B);
    assert(o.at <= 450, 'found right after the stagger, not after a timeout: ' + o.at);
  }
  // A refused address hands over to the next at once, without waiting for the stagger.
  {
    const w = world(), h = w.host({[A]: {ok: false}, [B]: {ok: true, after: 10}});
    const o = w.outcome(h.connect(w.c.createMenuRequestScope()));
    await w.advance(1000);
    assert(o.done && o.value === B);
    assert(w.requests[1].at < 300, 'the next address starts as soon as the first failed: ' + w.requests[1].at);
  }
  // An address that now belongs to another PC is not this PC.
  {
    const w = world(), h = w.host({[A]: {ok: 'other-pc', after: 10}, [B]: {ok: true, after: 10}});
    const o = w.outcome(h.connect(w.c.createMenuRequestScope()));
    await w.advance(1000);
    assert(o.done && o.value === B);
  }
  // When two answer, the preferred one wins if it answers first; a faster later one wins otherwise.
  {
    const w = world(), h = w.host({[A]: {ok: true, after: 1000}, [B]: {ok: true, after: 100}});
    const o = w.outcome(h.connect(w.c.createMenuRequestScope()));
    await w.advance(2000);
    assert(o.done && o.value === B, 'first valid answer wins');
  }
  // Nobody answers: it fails once, at about the shared deadline, having tried every candidate.
  {
    const w = world(), h = w.host({});
    const o = w.outcome(h.connect(w.c.createMenuRequestScope()));
    await w.advance(30000);
    assert(o.done && o.error && o.error.message === 'PC did not respond');
    assert(o.at >= 20000 && o.at <= 26500, 'fails near the deadline: ' + o.at);
    assert.strictEqual(w.requests.length, 5, 'all five candidates were tried');
    assert.strictEqual(o.error.tried, 5, 'the failure says how many were tried');
    assert.strictEqual(w.timers.length, 0);
  }
  // Everything refuses: it fails immediately, not after the staggers.
  {
    const w = world(), h = w.host({[A]: {ok: false}, [B]: {ok: false}, [C]: {ok: false}, [D]: {ok: false}, [E]: {ok: false}});
    const o = w.outcome(h.connect(w.c.createMenuRequestScope()));
    await w.advance(500);
    assert(o.done && o.error && o.error.tried === 5, 'all refused quickly');
    assert(o.at < 300);
  }
  // Cancelling stops the probing: no new address is asked afterwards.
  {
    const w = world(), h = w.host({});
    const scope = w.c.createMenuRequestScope();
    const o = w.outcome(h.connect(scope));
    await w.advance(100);
    const asked = w.requests.length;
    scope.cancel();
    await w.advance(5000);
    assert(o.done && o.error, 'cancelled');
    assert.strictEqual(w.requests.length, asked, 'no probe starts after the cancellation');
  }
  // Duplicates and loopback stay out: an address given twice is asked once.
  {
    const w = world(), h = w.host({});
    h.localAddress = h.address; h.userEnteredAddress = '127.0.0.1'; h.externalIP = '';
    const o = w.outcome(h.connect(w.c.createMenuRequestScope()));
    await w.advance(30000);
    assert(o.done && o.error);
    assert.deepStrictEqual([...new Set(w.requests.map(r => r.address))].sort(), [A, 'pc.local'].sort());
  }
  console.log('host_discovery_test: slow PC found, dead addresses do not delay, first valid answer wins, one shared deadline, cancel stops probing PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

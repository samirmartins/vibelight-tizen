'use strict';
// Resume after a connection drop, rules only: which endings offer a resume, the saved setting
// (on by default) and the limit of automatic resumes in a row. No DOM, no timers.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
function load() {
  const context = vm.createContext({String, Number, isFinite, parseInt});
  vm.runInContext(fs.readFileSync('wasm/platform/resume-on-drop.js', 'utf8'), context);
  return context.ResumeOnDrop;
}
const storage = (initial = {}, broken = false) => {
  const data = Object.assign({}, initial);
  return {getItem: k => { if (broken) throw Error('x'); return k in data ? data[k] : null; },
    setItem: (k, v) => { if (broken) throw Error('x'); data[k] = String(v); }, data};
};

// The setting: on by default, saved as asked, a blocked storage keeps the default.
let api = load();
assert.strictEqual(api.enabled(storage()), true);
assert.strictEqual(api.enabled(storage({[api.KEY]: '0'})), false);
assert.strictEqual(api.enabled(storage({[api.KEY]: '1'})), true);
assert.strictEqual(api.enabled(storage({[api.KEY]: 'junk'})), true);
assert.strictEqual(api.enabled(storage({}, true)), true);
assert.strictEqual(api.enabled(null), true);
const s = storage();
assert.strictEqual(api.setEnabled(s, false), true); assert.strictEqual(api.enabled(s), false);
assert.strictEqual(api.setEnabled(s, true), true); assert.strictEqual(api.enabled(s), true);
assert.strictEqual(api.setEnabled(storage({}, true), false), false);

// Which endings offer a resume: network and video drops only.
for (const code of [-100, -101, -1, -2, -7, 3, 1234]) assert.strictEqual(api.eligible(code), true, 'drop ' + code);
for (const code of [0, -102, -103, -104]) assert.strictEqual(api.eligible(code), false, 'no resume for ' + code);
for (const code of [NaN, undefined, null, 'x', Infinity]) assert.strictEqual(api.eligible(code), false, 'not a code: ' + code);

const HOST = {name: 'pc'};
function session() { api = load(); return api; }
const decide = (extra = {}) => api.onTermination(Object.assign({code: -101, now: 100000, enabled: true}, extra));

// Nothing to resume without a launch noted, with the setting off, or for an ending that does not qualify.
session();
assert.strictEqual(decide().resume, false, 'no launch noted');
api.noteLaunch(HOST, 7, 0, false);
assert.strictEqual(decide({enabled: false}).resume, false, 'setting off');
api.noteLaunch(HOST, 7, 0, false);
assert.strictEqual(decide({code: 0}).resume, false, 'graceful end');
api.noteLaunch(HOST, 7, 0, false);
assert.strictEqual(decide({code: -103}).resume, false, 'host error');

// A drop resumes the game that was streaming, on that host.
session(); api.noteLaunch(HOST, 7, 0, false);
let result = decide({now: 30000});
assert.strictEqual(result.resume, true); assert.strictEqual(result.appId, 7); assert.strictEqual(result.host, HOST);

// Up to 3 automatic resumes in a row; the 4th drop does not resume.
session(); api.noteLaunch(HOST, 7, 0, false);
for (let i = 1; i <= 3; i++) {
  result = decide({now: 1000 * i}); assert.strictEqual(result.resume, true, 'resume ' + i);
  api.noteLaunch(HOST, 7, 1000 * i, true); // the automatic start does not reset the count
}
assert.strictEqual(decide({now: 5000}).resume, false, 'limit of 3 reached');

// A stream that lasts 2 minutes or more starts the count again.
session(); api.noteLaunch(HOST, 7, 0, false);
for (let i = 1; i <= 3; i++) { decide({now: 1000 * i}); api.noteLaunch(HOST, 7, 1000 * i, true); }
assert.strictEqual(decide({now: 1000 * 3 + 119999}).resume, false, 'just under 2 minutes does not reset');
session(); api.noteLaunch(HOST, 7, 0, false);
for (let i = 1; i <= 3; i++) { decide({now: 1000 * i}); api.noteLaunch(HOST, 7, 1000 * i, true); }
assert.strictEqual(decide({now: 3000 + 120000}).resume, true, 'a 2 minute stream resets the count');

// A manual launch also starts the count again, and a graceful end forgets the game.
session(); api.noteLaunch(HOST, 7, 0, false);
for (let i = 1; i <= 3; i++) { decide({now: 1000 * i}); api.noteLaunch(HOST, 7, 1000 * i, true); }
api.noteLaunch(HOST, 9, 5000, false);
result = decide({now: 6000}); assert.strictEqual(result.resume, true); assert.strictEqual(result.appId, 9);
session(); api.noteLaunch(HOST, 7, 0, false);
decide({code: 0});
assert.strictEqual(decide({code: -101}).resume, false, 'nothing left to resume after a graceful end');

// A drop is offered once: the same ending cannot be used twice without a new launch.
session(); api.noteLaunch(HOST, 7, 0, false);
assert.strictEqual(decide().resume, true);
assert.strictEqual(decide().resume, false, 'one resume per launch noted');
console.log('resume_on_drop_rules_test: setting, eligible endings, limit of 3 and reset rules PASS');

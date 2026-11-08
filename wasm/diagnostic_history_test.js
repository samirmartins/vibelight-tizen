'use strict';
const assert = require('assert');
const history = require('./platform/diagnostic-history.js');
const data = new Map(); let failRead = false, failWrite = false;
const storage = {getItem(k) { if (failRead) throw Error('read'); return data.get(k) || null; },
 setItem(k,v) { if (failWrite) throw Error('quota'); data.set(k,v); }};
const store = history.create(storage);
const record = (id, duration = 60000) => ({version:2,id:String(id),createdAt:1700000000000+id,
 durationMs:duration,recordedMs:duration,config:{fps:60,pacing:true},metrics:{fpsReceived:60,
 audioUnderruns:1},rows:[['FPS','60']],details:[['Clock','unavailable']]});
assert.deepStrictEqual(store.list().records, []);
for(let i=1;i<=11;i++) assert(store.save(record(i)).ok);
assert.deepStrictEqual(store.list().records.map(r=>r.id),['11','10','9','8','7','6','5','4','3','2']);
assert(store.save(record(11)).ok); assert.equal(store.list().records.length,10,'idempotent finish');
assert.equal(history.create(storage).list().records[0].id,'11','survives restart');
const before = data.get(history.key);
failWrite = true; assert(!store.save(record(12)).ok); assert.equal(data.get(history.key), before);
failWrite = false; failRead = true; assert(!store.save(record(12)).ok); assert.equal(data.get(history.key),before);
failRead = false;
data.set(history.key,'{broken'); assert(!store.list().ok); assert(!store.save(record(12)).ok);
assert.equal(data.get(history.key),'{broken','corrupt history is not overwritten');
data.delete(history.key);
const legacy = JSON.stringify({title:'Old report',rows:[['FPS','59.9']],config:'1080p'});
data.set(history.legacyKey,legacy);
failWrite=true; assert(!store.list().ok); assert.equal(data.get(history.legacyKey),legacy);
failWrite=false; assert(store.list().ok); assert.equal(store.list().records[0].legacy,true);
assert.equal(store.list().records.length,1,'migration is idempotent');
assert.equal(data.get(history.legacyKey),legacy,'migration preserves source');
assert(!store.save({...record(13),metrics:{fpsReceived:NaN}}).ok);
assert(!store.save({...record(13),rows:[['x','x'.repeat(100000)]]}).ok);
const incomplete=record(13);delete incomplete.details;
assert(!history.valid(incomplete),'stored reports require renderable technical details');
const a=record(1,120000), b=record(2,60000); a.metrics.audioUnderruns=2;
const rows=history.compare(a,b);
const rate=rows.find(r=>r.key==='audioUnderruns');
assert.equal(rate.a,1); assert.equal(rate.b,1); assert.equal(rate.delta,0,'normalize events by recorded duration');
const nativeA={...a,nativeMs:30000,metrics:{clientRejects:2,recoveries:2}};
const nativeB={...b,nativeMs:15000,metrics:{clientRejects:1,recoveries:1}};
for(const key of ['clientRejects','recoveries']){
 const nativeRate=history.compare(nativeA,nativeB).find(r=>r.key===key);
 assert.equal(nativeRate.a,4,'native events use their measured coverage');assert.equal(nativeRate.delta,0);
 assert.equal(nativeRate.durationA,30000);assert.equal(nativeRate.durationB,15000);
}
assert.equal(history.compare({...nativeA,nativeMs:0},nativeB).find(r=>r.key==='clientRejects').a,null);
const fps=rows.find(r=>r.key==='fpsReceived'); assert.equal(fps.delta,0);
delete b.metrics.fpsReceived; assert.equal(history.compare(a,b).find(r=>r.key==='fpsReceived').delta,null);
b.recordedMs=0; assert.equal(history.compare(a,b).find(r=>r.key==='audioUnderruns').b,null);
assert.throws(()=>history.compare(a,a),/distinct/i);
assert.equal(history.compare(a,{...b,legacy:true,metrics:{}}).find(r=>r.key==='fpsReceived').b,null);
const pick=history.selection(); assert(pick.toggle('1')); assert(pick.toggle('2'));
assert(!pick.toggle('3')); assert.deepStrictEqual(pick.ids(),['1','2']);
pick.toggle('1'); assert(pick.toggle('3')); assert.deepStrictEqual(pick.ids(),['2','3']);
console.log('diagnostic_history_test: retention, migration, failure preservation, rates, missing data and selection PASS');


'use strict';
const assert=require('assert'),fixture=require('./fixtures/diagnostic-runtime.cjs');
const f=fixture(true),d=f.d;
d.start();d.connected();d.sample('not json');d.finish();
assert.equal(f.timers.size+f.frames.size+f.events.length,0,'disabled lifecycle is inert');
d.start();d.connected();d.activate();const gen=f.generations.at(-1);
f.frame(100,1);f.frame(116.667,2);f.frame(183.334,3);f.frame(250.001,7);
d.sample('null');d.sample('{"gen":1,"ms":2000}');d.sample(f.sample(999));
assert.equal(d._debug().windows,0);
d.sample(f.sample(gen));assert.equal(d._debug().metrics.lead.min,-5);
const sample=f.sample(gen);
for(let i=0;i<7200;i++){f.advance(2000);d.sample(sample);}
assert.equal(d._debug().first.length,15);assert.equal(d._debug().last.length,15);
assert.equal(d._debug().presentationBins.length,2048);
assert.equal(f.timers.size,1);assert.equal(f.frames.size,1);
const stale=[...f.frames.values()][0];d.finish('Exit code 0');
assert.equal(f.timers.size+f.frames.size+f.listeners.size,0);
const r=f.c.DiagnosticHistory.create(f.c.localStorage).list().records[0];
assert.equal(r.rows.length,9);assert.equal(r.details.length,8);
assert.equal(r.metrics.coalesced,1);assert(r.metrics.presentMax>66);
assert(r.metrics.presentP95<=r.metrics.presentMax,'histogram approximation cannot exceed observed max');
assert(JSON.stringify(r).length<32768,'summary stays bounded after hours');
const count=f.events.length;stale(500,{presentedFrames:10});d.sample(sample);
assert.equal(f.events.length,count);assert.equal(f.frames.size,0);
d.start();d.connected();d.activate();const fresh=d._debug();d.sample(sample);assert.equal(fresh.windows,0);
d.finish();
// Missing sources stay unavailable instead of manufacturing healthy zeroes.
delete f.video.requestVideoFrameCallback;
f.c._mlAudioStats.started=false;f.c.tizen.systeminfo.getAvailableMemory=()=>{throw Error('unsupported');};
d.start();d.connected();d.activate();d.sample(f.sample(f.generations.at(-1),{rtt:-1,enc:-1,hostN:0,cadN:0,leadN:0}));d.finish();
const absent=f.c.DiagnosticHistory.create(f.c.localStorage).list().records[0];
for(const key of ['fpsHost','fpsPresented','rtt','rttVariation','hostProcessing','hostProcessingMax','audioQueue','audioUnderruns'])assert.equal(absent.metrics[key],null,key);
console.log('diagnostics_test: OFF, bounded long sessions, signed clocks, missing sources and stale callbacks PASS');

'use strict';
// Execute the real launcher/lifecycle and menu switch with deferred native stop.
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('wasm/app_lifecycle_test.js','utf8');
const prelude=source.slice(0,source.lastIndexOf('\n(async()=>{')); 
const h={require,console};vm.createContext(h);vm.runInContext(prelude+'\nglobalThis.makeFixture=fixture;globalThis.runLauncher=realLauncher;',h);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function make() {
 const f=h.makeFixture(),r=h.runLauncher(f,'none'),c=f.c;let stopping=true,refresh=0;
 c.Module.sessionGeneration=4;c.Module.isStreamStopping=()=>stopping;
 f.host.refreshServerInfo=()=>{refresh++;return Promise.resolve();};
 const messages=[];c.snackbarLog=c.snackbarLogLong=text=>messages.push(text);
 return {f,r,c,messages,refresh:()=>refresh,finish(){stopping=false;c.AppLifecycle.streamStopped(4);}};
}
(async()=>{
 let x=make();x.c.startGame(x.f.host,2);await x.f.flush();
 assert.equal(x.refresh(),0);assert(!x.r.calls.includes('launch'));assert(x.messages.includes('Finishing previous session...'));
 x.c.AppLifecycle.streamStopped(3);await x.f.flush();assert.equal(x.refresh(),0);
 x.finish();await x.f.flush();assert.equal(x.refresh(),1);assert.equal(x.r.calls.filter(v=>v.kind==='startRequest').length,1);
 assert.equal(x.f.timers.size,0);x.f.c.ConsoleLibrary.suspend();
 x=make();x.c.startGame(x.f.host,2);await x.f.flush();
 const timer=[...x.f.timers].find(([,t])=>t.ms===8000);assert(timer);x.f.timers.delete(timer[0]);timer[1].fn();await x.f.flush();
 assert.equal(x.refresh(),0);assert(x.messages.includes('Previous stream is still closing. Retry shortly.'));
 x.finish();await x.f.flush();assert.equal(x.refresh(),0);x.f.c.ConsoleLibrary.suspend();
 x=make();x.c.startGame(x.f.host,2);await x.f.flush();x.f.visibility(true);await x.f.flush();x.finish();await x.f.flush();
 assert.equal(x.refresh(),0);assert.equal(x.f.timers.size,0);x.f.c.ConsoleLibrary.suspend();
 x=make();x.c.startGame(x.f.host,2);await x.f.flush();x.c.startGame(x.f.host,3);await x.f.flush();
 assert.equal(x.f.timers.size,1,'superseded wait is removed');x.finish();await x.f.flush();assert.equal(x.refresh(),1);assert.equal(x.r.calls.filter(v=>v.kind==='startRequest').length,1);x.f.c.ConsoleLibrary.suspend();
 // Actual close-and-start route: confirmed host closure replaces the fixed delay.
 x=make();x.finish();x.f.host.currentGame=7;
 const index=fs.readFileSync('wasm/platform/index.js','utf8');
 vm.runInContext(index.slice(index.indexOf('function stopGame('),index.indexOf('// Send the Escape key')),x.c);
 const handlers={},query=x.c.$;x.c.$=selector=>{const q=query(selector);q.on=(name,fn)=>{handlers[selector]=fn;return q;};return q;};x.c.$.parseXML=query.parseXML;
 x.f.node('quitAppDialog').showModal=function(){this.open=true;};
 x.c.document.querySelector=selector=>x.f.node(selector.slice(1));x.c.Navigation.push=()=>{};
 x.f.host.getAppById=id=>Promise.resolve({id,title:'Game '+id});
 const quit=deferred();let quits=0;x.f.host.quitApp=()=>{quits++;return quit.promise;};x.c.showApps=()=>Promise.resolve();
 x.c.startGame(x.f.host,2);await x.f.flush();assert(handlers['#continueQuitApp']);handlers['#continueQuitApp']();await x.f.flush();assert.equal(quits,1);assert(!x.r.calls.includes('launch'));
 x.f.host.currentGame=0;quit.resolve();await x.f.flush();assert.equal(x.r.calls.filter(v=>v==='launch').length,1);assert(![...x.f.timers.values()].some(t=>t.ms===3000),'no fixed 3 s launch delay');
 let completed=0;await x.c.stopGame(x.f.host,()=>completed++);assert.equal(completed,1);assert.equal(quits,1,'already closed does not send quit again');x.f.c.ConsoleLibrary.suspend();
 // Smart Hub retires an explicit host quit without a stale local stop.
 x=make();let cancelled=0,retired=false;const pending=deferred();
 pending.promise.cancel=()=>{if(!retired){retired=true;cancelled++;}};
 x.c.api.quitApp=()=>{x.c.api._quitOperation=pending.promise;return pending.promise;};
 vm.runInContext(fs.readFileSync('wasm/platform/stream-session.js','utf8'),x.c);
 x.c.StreamSession.endHostGame();x.f.visibility(true);assert.equal(cancelled,1);assert(!x.c.StreamSession.isPending());
 pending.resolve();await x.f.flush();assert.equal(x.f.log.filter(v=>v==='native stop').length,0);
 x.f.c.ConsoleLibrary.suspend();
 console.log('session_transition_test: immediate/manual switch, native readiness, stale completion, timeout, hide, superseding launch and already-closed host PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});

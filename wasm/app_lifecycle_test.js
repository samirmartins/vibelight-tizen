'use strict';
// Scenarios run in the same scope as wasm/fixtures/app-lifecycle-prelude.js,
// with the same Node globals as a top-level test.
const prelude = require('fs').readFileSync('wasm/fixtures/app-lifecycle-prelude.js', 'utf8');
new Function('require', prelude + '\n(' + scenarios + ')();')(require);
function scenarios() {
  (async()=>{
   // No polling/timer registration at lifecycle load, and only one event hook.
   assert(!/set(?:Timeout|Interval)|requestAnimationFrame|sendWOL|quitApp\(/.test(lifecycle));
   let f=fixture();assert.strictEqual(f.timers.size,0);assert.strictEqual(f.log.length,0);
   f.visibility(false);assert.strictEqual(f.log.length,0);
   for(let cycle=0;cycle<100;cycle++) {
    f.c.isInGame=true;f.c._mlAudioCtx={state:'running'};
    const token=f.c.AppLifecycle.epoch();f.visibility(true);
    assert(!f.c.AppLifecycle.current(token));assert(f.c.hostOpenRequest,'pairing/open guard is not reset by suspension');
    assert.strictEqual(f.c._mlAudioCtx,null);assert(f.log.includes('nav stop'));
    const count=f.log.length;f.visibility(true);assert.strictEqual(f.log.length,count);
    // Real stream termination would clean up first, then defer menu work.
    assert(f.c.AppLifecycle.deferMenu(f.host));assert.strictEqual(f.calls.connect,cycle);
    f.visibility(false);await f.flush();
    assert.strictEqual(f.log.filter(x=>x==='menu').length,cycle+1,'one library return, including reentrant stop callback');
    assert.strictEqual(f.calls.connect,cycle+1);assert.strictEqual(f.launched.length,0);
    assert.strictEqual(f.calls.wake,0);assert.strictEqual(f.calls.audio,0);
    assert(!f.c.isInGame);assert(f.c.AppLifecycle.current(f.c.AppLifecycle.epoch()));
    const size=f.log.length;f.visibility(false);assert.strictEqual(f.log.length,size);
    f.c.ConsoleLibrary.suspend();assert.strictEqual(f.timers.size,0);
   }
   // Native capture may deliver termination before the JS visibility listener.
   f=fixture();f.c.isInGame=true;f.c.document.hidden=true;
   assert(f.c.AppLifecycle.deferMenu(f.host));f.visibility(true);f.visibility(false);await f.flush();
   assert.strictEqual(f.log.filter(x=>x==='menu').length,1);assert.strictEqual(f.launched.length,0);
   f.c.ConsoleLibrary.suspend();
   // Exercise the actual termination/connection message handler, not just its
   // adapter: hidden termination must not open the library or schedule UI work.
   f=fixture();let connected=0,focused=0;
   f.c.SessionDiagnostics.connected=()=>connected++;
   f.c.$=()=>({children(){return this;},show(){return this;},hide(){return this;},css(){return this;},removeClass(){return this;},focus(){focused++;},prop(){return false;}});
   vm.runInContext(fs.readFileSync('wasm/platform/messages.js','utf8'),f.c);
   f.c.isInGame=true;f.visibility(true);
   f.c.handleMessage('streamTerminated: 0');
   assert(!f.log.includes('menu'));assert.strictEqual(f.timers.size,0);
   f.c.handleMessage('Connection Established');assert.strictEqual(connected,0);
   f.visibility(false);await f.flush();
   f.c.handleMessage('Connection Established');assert.strictEqual(connected,0);
   f.c.isInGame=true;f.c.handleMessage('Connection Established');
   assert.strictEqual(connected,1);assert.strictEqual(focused,1);
   f.c.ConsoleLibrary.suspend();
   // An offline, pending Wake packet is cancelled; even a late successful packet
   // reply must not start polling, create audio again or launch on return.
   f=fixture({online:false,wakeDelayed:true});
   ['hosts','runtime'].forEach(x=>f.c.ConsoleLibrary.ready(x));await f.flush();
   f.node('libraryWake').click();assert.strictEqual(f.calls.wake,1);
   f.visibility(true);f.host.online=true;f.host.resolveWake();await f.flush();
   assert.strictEqual(f.launched.length,0);assert.strictEqual(f.timers.size,0);
   f.visibility(false);await f.flush();assert.strictEqual(f.launched.length,0);assert.strictEqual(f.calls.wake,1);
   f.c.ConsoleLibrary.suspend();
   // Settings remain settings, unrelated dialogs remain open, and host-list
   // polling is restored even if the previous HTTP request had no timer yet.
   f=fixture();['runtime','hosts'].forEach(x=>f.c.ConsoleLibrary.ready(x));await f.flush();
   f.c.ConsoleLibrary.settings();f.c.isDialogOpen=true;f.c.hostPollScopes={fixture:{}};
   f.visibility(true);f.visibility(false);await f.flush();
   assert(!f.c.ConsoleLibrary.visible());assert(f.c.isDialogOpen);
   assert(!f.log.includes('menu'));assert(!f.log.includes('nav switch'));assert(f.log.includes('startPollingHosts'));
   // A launch confirmation must not remain frozen with stale click handlers.
   f=fixture();f.node('quitAppDialog').open=true;f.c.isDialogOpen=true;
   f.visibility(true);assert(!f.node('quitAppDialog').open);assert(!f.c.isDialogOpen);
   assert.strictEqual(f.calls.wake,0);assert.strictEqual(f.launched.length,0);
   // Loading while hidden delays ordinary library refresh until foreground.
   f=fixture({hidden:true});['hosts','runtime'].forEach(x=>f.c.ConsoleLibrary.ready(x));await f.flush();
   assert.strictEqual(f.calls.connect,0);f.visibility(false);await f.flush();
   assert.strictEqual(f.calls.connect,1);assert.strictEqual(f.launched.length,0);f.c.ConsoleLibrary.suspend();
   // Pending refresh/app lookup/launch/resume responses cannot start WASM, both
   // while hidden and after returning. Rejections are equally inert.
   for(const stage of ['refresh','app','result'])for(const resume of [false,true])for(const fail of [false,true])for(const returned of [false,true]) {
    f=fixture();const r=realLauncher(f,stage,resume);
    f.c.startGame(f.host,2,false);await f.flush();f.visibility(true);
    if(returned){f.visibility(false);await f.flush();}
    if(fail)r.gate.reject(Error('synthetic delayed failure'));else r.gate.resolve(stage==='app'?{id:2,title:'Example Game'}:'xml');
    await f.flush();
    assert(!r.calls.some(x=>x.kind==='startRequest'),'no stale native launch '+JSON.stringify({stage,resume,fail,returned}));
    assert(!r.calls.includes('snackbar'));assert.strictEqual(f.calls.wake,0);
    f.c.ConsoleLibrary.suspend();
   }
   // Visible manual Play and Resume still use the same payload and preparation.
   for(const resume of [false,true]) {
    f=fixture();const r=realLauncher(f,'none',resume);f.c.startGame(f.host,2,false);await f.flush();
    assert(r.calls.includes(resume?'resume':'launch'));
    const sent=r.calls.find(x=>x.kind==='startRequest');assert(sent);assert.strictEqual(sent.args.length,26);
    assert.strictEqual(r.calls.filter(x=>x==='audio').length,1);assert.strictEqual(r.calls.filter(x=>x==='scheduler').length,1);
    const oldIndex=cp.execFileSync('git',['show','df6eb63:wasm/platform/index.js'],{encoding:'utf8'});
    const baseline=fixture(),old=realLauncher(baseline,'none',resume,oldIndex.slice(oldIndex.indexOf('function startGame('),oldIndex.indexOf('// Stop the running app title')));
    baseline.c.startGame(baseline.host,2,false);await baseline.flush();
    const expectedArgs=old.calls.find(x=>x.kind==='startRequest').args.slice();
    expectedArgs.splice(16,2); // Only the two explicitly retired flip arguments.
    assert.strictEqual(JSON.stringify(sent.args),JSON.stringify(expectedArgs),'native stream payload equals base except retired flip arguments');
   }
   // Wake reuses gesture-prepared audio and the original manual-launch validation.
   for(const resume of [false,true]) {
    f=fixture();const r=realLauncher(f,'none',resume);let info=0;
    f.host.refreshServerInfo=()=>{info++;return Promise.resolve();};
    f.c.startGame(f.host,2,true);await f.flush();
    assert.strictEqual(info,1);assert(r.calls.includes(resume?'resume':'launch'));
    assert(r.calls.some(x=>x.kind==='startRequest'));assert(!r.calls.includes('audio'));
   }
   assert(!index.slice(0,index.indexOf('function startGame(')).includes('launchCurrent'));
   assert(!index.slice(index.indexOf('// Stop the running app title')).includes('launchCurrent'));
   assert.strictEqual((fs.readFileSync('wasm/index.html','utf8').match(/src="platform\/app-lifecycle.js"/g)||[]).length,1);
   console.log('app_lifecycle_test: 100 hide/show cycles, hidden startup/menu/settings, wake cancellation, 20 delayed launch/resume outcomes, manual launch and single lifecycle script OK');
  })().catch(e=>{console.error(e);process.exitCode=1;});
}

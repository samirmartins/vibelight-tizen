'use strict';
// Real menu, host coordinator and lifecycle; synthetic native completion/HTTP.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),cp=require('child_process');
const {setup}=require('./host_availability_test.js');
const native=fs.readFileSync('wasm/main.cpp','utf8');
const afterStop=native.slice(native.indexOf('  // Last instance access:'));
const bridge=afterStop.match(/m_StopComplete\.store\(true[^;]+;\s*MAIN_THREAD_ASYNC_EM_ASM\(\{([\s\S]*?)\n  \}, generation\);/);
assert(bridge,'native completion posts only after publishing the completed state');

function fixture() {
  const f=setup(),c=f.c,events={};
  f.stopping=false;
  c.Module={sessionGeneration:1,isStreamStopping:()=>f.stopping};
  c.document.addEventListener=(name,fn)=>{events[name]=fn;};
  c.SessionDiagnostics={finish(){}};
  c.stopVideoPresentationObserver=()=>{};
  c.Navigation.switch=()=>{};
  const query=c.$;
  c.$=value=>typeof value==='string'&&value.startsWith('<')?query(value):{
    children(){return this;},show(){return this;},hide(){return this;},
    css(){return this;},removeClass(){return this;},prop(){return false;}
  };
  c.$.parseXML=value=>value;
  c.showApps=host=>c.ConsoleLibrary.open(host);
  vm.runInContext(fs.readFileSync('wasm/platform/app-lifecycle.js','utf8'),c);
  const transport=c.sendMessage;
  vm.runInContext(fs.readFileSync('wasm/platform/messages.js','utf8'),c);
  c.sendMessage=transport;
  f.finish=()=>{f.stopping=false;f.state='on';c.$0=c.Module.sessionGeneration;vm.runInContext(bridge[1],c);};
  f.exit=()=>{
    c.ConsoleLibrary.suspend();c.isInGame=true;f.stopping=true;f.state='off';
    c.handleMessage('streamTerminated: 0');
    // Advance the pre-existing navigation-only timer, not the new cleanup bound.
    f.fire(1500);
  };
  f.fire=ms=>{
    const entry=[...f.timers].find(([,timer])=>timer.ms===ms);assert(entry,'timer '+ms);
    f.timers.delete(entry[0]);entry[1].fn();
  };
  return f;
}
async function returnFromSettings(f) {
  f.c.ConsoleLibrary.settings();assert(f.c.ConsoleLibrary.back());await f.flush();
}
async function run() {
  const scope=require('./stream-return-scope.cjs');
  for(const file of scope.files) {
    const text=fs.readFileSync(file,'utf8');
    assert.strictEqual(scope.normalize(file,text),cp.execFileSync('git',['show','v3.4.12:'+file],{encoding:'utf8'}));
    assert.strictEqual(scope.normalize(file,text+'\n// unrelated mutation\n'),text+'\n// unrelated mutation\n');
  }
  const routes=f=>f.requests.map(args=>args[0].replace(/&uuid=[^&]+/,''));
  // Both entry paths already use the same library coordinator when ready.
  let f=fixture();f.state='on';await f.open();
  assert(f.host.online&&f.host._authenticatedOnline,'fixture starts with a real successful parser/transport check');
  const first=routes(f);f.requests.length=0;
  await returnFromSettings(f);assert.deepStrictEqual(routes(f),first);
  f.requests.length=0;f.exit();await f.flush();
  assert.strictEqual(f.requests.length,0,'post-stream status must wait for native cleanup, not probe the closing host');
  assert(f.host.online,'local teardown is not evidence that the PC is offline');
  assert(f.card(1),'cached library appears without waiting for cleanup');
  // An older completion cannot release the current generation.
  f.c.AppLifecycle.streamStopped(0);await f.flush();assert.strictEqual(f.requests.length,0);
  f.finish();await f.flush();
  assert(f.host.online&&f.host._authenticatedOnline&&f.host.paired);
  assert.match(f.node('libraryStatus').textContent,/PC online/);
  assert.strictEqual(f.requests.length,2,'one normal serverinfo/applist check after cleanup');
  assert(f.requests[0][0].includes('/serverinfo?'));assert(f.requests[1][0].includes('/applist?'));
  const covers=f.calls.length;f.requests.length=0;
  await returnFromSettings(f);assert.deepStrictEqual(routes(f),first);
  assert.strictEqual(f.calls.length,covers,'return reuses artwork');
  f.suspend();

  // No extra ready-stream work or duplicate query after an already finished stop.
  f=fixture();f.state='on';await f.open();f.requests.length=0;
  f.c.handleMessage('streamTerminated: 0');await f.flush();
  f.fire(1500);
  assert.strictEqual(f.requests.length,2);f.c.AppLifecycle.streamStopped(1);await f.flush();
  assert.strictEqual(f.requests.length,2);f.suspend();

  // Cancellation prevents a completion from reviving Settings or another stream.
  for(const action of ['settings','stream','hidden']) {
    f=fixture();f.state='on';await f.open();f.requests.length=0;f.exit();await f.flush();
    if(action==='settings')f.c.ConsoleLibrary.settings();
    else if(action==='hidden'){f.c.document.hidden=true;f.c.ConsoleLibrary.pause();}
    else f.suspend();
    f.finish();await f.flush();assert.strictEqual(f.requests.length,0,'cancelled '+action);
    f.suspend();assert.strictEqual(f.timers.size,0);
  }

  // A missing native callback is a bounded local error, not a false PC-offline claim.
  f=fixture();f.state='on';await f.open();f.requests.length=0;f.exit();await f.flush();
  f.fire(8000);await f.flush();
  assert.strictEqual(f.requests.length,0);assert(f.host.online&&f.host._authenticatedOnline);
  assert.match(f.node('libraryStatus').textContent,/stream is still closing/);
  f.finish();await f.flush();assert.strictEqual(f.requests.length,0,'timeout never starts a retry loop');
  f.requests.length=0;await returnFromSettings(f);assert.strictEqual(f.requests.length,2);f.suspend();

  // A real offline/authentication failure after cleanup remains a failed check.
  for(const state of ['off','denied']) {
    f=fixture();f.state='on';await f.open();f.requests.length=0;f.exit();await f.flush();
    f.stopping=false;f.state=state;f.c.AppLifecycle.streamStopped(1);await f.flush();
    assert(!f.host.online);assert.match(f.node('libraryStatus').textContent,/PC unavailable/);
    assert(f.host.paired,'a failed query never discards saved pairing');
    assert(f.requests.every(args=>args[0].includes('/serverinfo?')));f.suspend();
  }

  // All status consumers share the same barrier and distinguish local failure.
  for(const consumer of ['pc-list','legacy-poll']) {
    f=fixture();f.state='on';await f.open();f.requests.length=0;f.exit();await f.flush();
    f.c.ConsoleLibrary.settings();let completed=0;
    if(consumer==='pc-list') {
      const index=fs.readFileSync('wasm/platform/index.js','utf8');
      f.c.hostPollScopes={};f.c.activePolls={};f.c.updateHostStatusIndicator=()=>{};
      vm.runInContext(index.slice(index.indexOf('function beginBackgroundPollingOfHost('),index.indexOf('function stopPollingHosts(')),f.c);
      f.c.beginBackgroundPollingOfHost(f.host);
    } else {
      f.host._pollCompletionCallbacks=[];f.host._consecutivePollFailures=0;
      f.host.pollServer(()=>completed++,f.c.createMenuRequestScope());
    }
    await f.flush();assert.strictEqual(f.requests.length,0);
    f.fire(8000);await f.flush();assert(f.host.online&&f.host._authenticatedOnline);
    assert.strictEqual(f.host._memCachedApplist.length,1);
    if(consumer==='legacy-poll'){assert.strictEqual(completed,1);assert.strictEqual(f.host._consecutivePollFailures,0);}
    f.finish();await f.flush();assert.strictEqual(f.requests.length,0);f.suspend();
  }

  // Returning through Settings while stop is pending replaces, rather than duplicates, work.
  f=fixture();f.state='on';await f.open();f.requests.length=0;f.exit();await f.flush();
  f.c.ConsoleLibrary.settings();assert(f.c.ConsoleLibrary.back());await f.flush();
  assert.strictEqual(f.requests.length,0);f.finish();await f.flush();
  assert.strictEqual(f.requests.length,2);f.suspend();assert.strictEqual(f.timers.size,0);

  // No callback is required for a later explicit visit once native state is complete.
  f=fixture();f.state='on';await f.open();f.requests.length=0;f.exit();await f.flush();
  f.c.ConsoleLibrary.settings();f.stopping=false;f.state='on';
  assert(f.c.ConsoleLibrary.back());await f.flush();assert.strictEqual(f.requests.length,2);
  f.finish();await f.flush();assert.strictEqual(f.requests.length,2);f.suspend();

  // Repeated returns do not retain timers or create gameplay traffic.
  f=fixture();f.state='on';await f.open();
  for(let cycle=0;cycle<30;cycle++) {
    f.c.Module.sessionGeneration++;f.requests.length=0;f.exit();await f.flush();
    assert.strictEqual(f.requests.length,0);f.finish();await f.flush();
    assert.strictEqual(f.requests.length,2);f.suspend();assert.strictEqual(f.timers.size,0);
  }
  console.log('stream_return_test: shared Settings/stream path, cleanup barrier, stale completion, cancel, timeout, offline, artwork and 30 cycles OK');
}
run().catch(error=>{console.error(error);process.exitCode=1;});

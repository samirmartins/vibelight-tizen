'use strict';
// Scenarios run in the same scope as wasm/fixtures/startup-app-prelude.js,
// with the same Node globals as a top-level test.
const prelude = require('fs').readFileSync('wasm/fixtures/startup-app-prelude.js', 'utf8');
new Function('require', prelude + '\n(' + scenarios + ')();')(require);
function scenarios() {
  (async()=>{
   const html=fs.readFileSync('wasm/index.html','utf8');
   const css=fs.readFileSync('wasm/static/css/console-library.css','utf8');
   for(const name of ['libraryAutoStart','libraryAutoWake','libraryStartup','startAutomatic']){
    assert(!source.includes(name),'Removed automatic launcher code: '+name);
    assert(!html.includes(name),'Removed automatic launcher UI: '+name);
   }
   assert(!css.includes('.console-startup'));
   const cases=Number(process.env.ML_STARTUP_CASES||24),seed=Number(process.env.ML_STRESS_SEED||12345);
   assert(Number.isInteger(cases)&&cases>0&&cases<=100000);
   assert(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);
   let rng=seed;
   for(let index=0;index<cases;index++){
    rng=(Math.imul(rng,1664525)+1013904223)>>>0;
    const online=!!(rng&0x10000),wake=!!(rng&0x20000);
    const f=fixture({online,record:{startupApp:1,startupWake:wake,favorites:[2],recent:[1],focus:2}});
    const ready=rng&1?['hosts','runtime']:['runtime','hosts'];
    try {
     ready.forEach(part=>f.c.ConsoleLibrary.ready(part));await f.flush();
     assert.strictEqual(f.calls.connect,1,'The normal library refresh remains');
     assert.strictEqual(f.launched.length,0);assert.strictEqual(f.calls.wake,0);assert.strictEqual(f.calls.audio,0);
     f.c.ConsoleLibrary.ready('runtime');f.c.ConsoleLibrary.ready('hosts');await f.flush();
     assert.strictEqual(f.calls.connect,1,'Readiness is idempotent');
     assert.deepStrictEqual(f.prefs().favorites,[2]);assert.deepStrictEqual(f.prefs().recent,[1]);
     assert.strictEqual(f.prefs().focus,2);
     if(!online){assert.strictEqual(f.timers.size,0);assert.strictEqual(f.calls.wake,0);assert.strictEqual(f.launched.length,0);}
     // Old candidate preferences must never wake or launch, but manual Play still works.
     f.node('libraryPlay').click();await f.flush();
     assert.strictEqual(f.launched.length,1);assert.strictEqual(f.launched[0].app,2);
     assert.strictEqual(f.calls.wake,0);
     assert.strictEqual(f.calls.audio,0);
     f.c.ConsoleLibrary.suspend();await f.flush();assert.strictEqual(f.timers.size,0);
    } catch(error) {
     console.error('STRESS_CASE '+JSON.stringify({seed,index,online,wake,ready}));throw error;
    }
   }
   let f=fixture({online:false,wakeDelayed:true,record:{startupApp:1,startupWake:true}});
   ['hosts','runtime'].forEach(part=>f.c.ConsoleLibrary.ready(part));await f.flush();
   f.node('libraryWake').click();assert.strictEqual(f.calls.wake,1);
   f.node('libraryWake').click();assert.strictEqual(f.calls.wake,1);
   f.c.ConsoleLibrary.settings();f.host.online=true;f.host.resolveWake();await f.flush();
   assert.strictEqual(f.launched.length,0);assert.strictEqual(f.calls.close,0);
   f.c.ConsoleLibrary.suspend();assert.strictEqual(f.timers.size,0);
   f=fixture({delayed:true,record:{startupApp:1,startupWake:true}});
   ['runtime','hosts'].forEach(part=>f.c.ConsoleLibrary.ready(part));await f.flush();
   f.c.ConsoleLibrary.settings();f.host.resolve();await f.flush();
   assert.strictEqual(f.launched.length,0);assert.strictEqual(f.calls.wake,0);assert.strictEqual(f.calls.audio,0);
   assert(!f.c.ConsoleLibrary.visible());
   console.log('startup_app_test: '+cases+' cases; obsolete startup preferences inert, manual Play/WoL preserved, no automatic audio/launch, cancellation and settings return OK');
  })().catch(e=>{console.error(e);process.exitCode=1;});
}

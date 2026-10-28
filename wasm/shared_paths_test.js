'use strict';
// Compare the actual duplicate paths before extraction, then their replacements.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),cp=require('child_process');
const BASE='7b08c77',HTTP='wasm/static/js/utils.js',PAD='wasm/platform/gamepad.js';
const before=file=>cp.execFileSync('git',['show',BASE+':'+file],{encoding:'utf8'});
const oldHttp=before(HTTP),oldPad=before(PAD);
const compact=text=>text.split('\n').map(line=>line.trim()).join('\n').trim();
function runCleanup(body,slot,failAt) {
  const trace=[],c={slot,trace,_gpPhysicalForSlot:[1,3,5,7],_gpLogicalPads:['a','b','c','d'],
    _gpClearSlotMetadata(id){trace.push('metadata:'+id);if(failAt==='metadata')throw Error('metadata');},
    _rumbleForgetSlot(id){trace.push('rumble:'+id);if(failAt==='rumble')throw Error('rumble');}};
  let error='';try{vm.runInNewContext(body,c);}catch(e){error=e.message;}
  return JSON.stringify([c._gpPhysicalForSlot,c._gpLogicalPads,trace,error]);
}
function checkDuplicates() {
  const poll=oldPad.match(/if \(physical >= 0 && !_gpIsUsable\(existing\)\) \{\n([\s\S]*?)\n    \} else if/)[1];
  const event=oldPad.slice(oldPad.lastIndexOf("window.addEventListener('gamepaddisconnected'"))
    .match(/if \(slot >= 0\) \{\n([\s\S]*?)\n  \}/)[1];
  assert.strictEqual(compact(poll),compact(event),'the duplicated cleanup statements are identical');
  for(let slot=0;slot<4;slot++)for(const failure of ['', 'metadata','rumble'])
    assert.strictEqual(runCleanup(poll,slot,failure),runCleanup(event,slot,failure));
  const connections=[...oldPad.matchAll(/_gpCacheSlotMetadata\((slot|freeSlot), (existing|gamepad|event.gamepad)\);\n\s*_rumbleForgetSlot\(\1\);/g)];
  assert.strictEqual(connections.length,3,'three copies of the same connection lifecycle');
  for(const match of connections) {
    const text=match[0].replaceAll(match[2],'pad').replaceAll(match[1],'slot');
    for(const failure of ['', 'metadata','rumble']) {
      const traces=[],c={slot:2,pad:{id:'fixture'},_gpCacheSlotMetadata(slot,pad){traces.push('cache:'+slot+':'+pad.id);if(failure==='metadata')throw Error('metadata');},
        _rumbleForgetSlot(slot){traces.push('rumble:'+slot);if(failure==='rumble')throw Error('rumble');}};
      try{vm.runInNewContext(text,c);}catch(e){traces.push(e.message);}
      assert.deepStrictEqual(traces,failure==='metadata'?['cache:2:fixture','metadata']:
        failure==='rumble'?['cache:2:fixture','rumble:2','rumble']:['cache:2:fixture','rumble:2']);
    }
  }
}
function httpFixture(source) {
  const c={Promise,console:{log(){},warn(){},error(){}}};c.window=c;vm.createContext(c);vm.runInContext(source,c);
  return c;
}
async function request(source,resume,variant,failure) {
  const c=httpFixture(source),host=new c.NvHTTP('fixture.invalid','fixture'),trace=[],calls=[];
  host._baseUrlHttps='https://fixture.invalid:47984';host.ppkstr='fixture-pin';
  host._buildUidStr=()=>{trace.push('uid');return 'uniqueid=fixture&uuid=fixed';};
  const values=[undefined,null,false,0,-2147483648,2147483647,'','1280x720x60','a&b=?'];
  const error=Error('fixture failure');let settle;
  const promise=new Promise(resolve=>{settle=resolve;});
  c.sendMessage=(name,args)=>{trace.push('send');calls.push([name,...args]);if(failure==='send')throw error;return promise;};
  const value=(label,index)=>({toString(){trace.push(label);if(failure===label)throw error;
    return String(values[(variant+index)%values.length]);}});
  const args=['mode','sops','key','keyid','hdr','audio','surround','mask'].map(value);
  let returned,thrown;
  try{returned=resume?host.resumeApp(...args):host.launchApp(17,...args);}catch(e){thrown=e;}
  if(thrown)assert.strictEqual(thrown,error);else{assert.strictEqual(returned,promise,'no new promise/async layer');settle('reply');assert.strictEqual(await returned,'reply');}
  return {trace,calls,thrown:thrown&&thrown.message};
}
async function checkHttp(current) {
  let count=0;
  for(let variant=0;variant<9;variant++)for(const failure of ['', 'key','send']) {
    const launch=await request(oldHttp,false,variant,failure),resume=await request(oldHttp,true,variant,failure);
    const normalized=structuredClone(launch);
    if(normalized.calls.length)normalized.calls[0][1]=normalized.calls[0][1].replace('/launch?','/resume?').replace('&appid=17','');
    assert.deepStrictEqual(normalized,resume,'only endpoint and appid differ between old variants');
    if(current)for(const resume of [false,true])assert.deepStrictEqual(await request(current,resume,variant,failure),await request(oldHttp,resume,variant,failure));
    count++;
  }
  return count;
}
const prefix=fs.readFileSync('wasm/gamepad_snapshot_test.js','utf8').split('// A physical index hole')[0]
  .replace("fs.readFileSync('wasm/platform/gamepad.js', 'utf8')",'source');
function padFixture(source) {
  const out={};vm.runInNewContext(prefix+`
    output.c=context;output.pad=pad;output.tick=()=>rafCallback();output.listeners=listeners;
    output.pads=value=>{pads=value;};
    output.state=()=>JSON.stringify({heap:Array.from(heap32),notifications,rumbleCalls,
      slots:Array.from(context._gpPhysicalForSlot),known:Array.from(context._gpKnownPhysical),
      generations:Array.from(context._gpConnectionForSlot),types:Array.from(context._gpTypeForSlot),
      caps:Array.from(context._gpCapabilitiesForSlot),ids:context._gpIdForSlot,
      rumbleGeneration:Array.from(context._rumbleGeneration),rumbleAttempt:Array.from(context._rumbleAttempt)});
  `,{require,console,source,output:out});return out;
}
async function checkPads(source) {
  const a=padFixture(oldPad),b=padFixture(source),steps=[
    f=>{f.c.startGamepadSnapshot(true);f.tick();},
    f=>{f.pad.buttons[0]={value:1,pressed:true};f.pad.axes=[.25,-.5,.75,0];f.tick();},
    f=>{f.pad.id='045e-0b13-Controller';f.tick();},
    f=>{f.pad.connected=false;f.listeners.gamepaddisconnected.forEach(fn=>fn({gamepad:f.pad}));f.tick();},
    f=>{f.pad.connected=true;f.pad.timestamp++;f.listeners.gamepadconnected.forEach(fn=>fn({gamepad:f.pad}));f.tick();},
    f=>{f.listeners.gamepadconnected.forEach(fn=>fn({gamepad:f.pad}));f.tick();},
    f=>{const pads=[];for(const index of [1,3,5,7])pads[index]={...f.pad,index,id:index===1?f.pad.id:'057e-2009-Controller'};f.pads(pads);f.tick();},
    f=>{f.pads([]);f.tick();},
    f=>{f.c.stopGamepadSnapshot();}
  ];
  for(const step of steps){step(a);step(b);for(let i=0;i<6;i++)await Promise.resolve();assert.strictEqual(a.state(),b.state(),'same snapshots, metadata, notifications and rumble ownership after each transition');}
  return steps.length;
}
(async()=>{
  checkDuplicates();const preflight=process.argv.includes('--preflight');
  const cases=await checkHttp(preflight?null:fs.readFileSync(HTTP,'utf8'));
  if(preflight){console.log('shared_paths_test: preflight; equivalent duplicated cleanup/connection operations, '+cases+' Play/Resume parameter/error cases; no conflicting behavior selected PASS');return;}
  const transitions=await checkPads(fs.readFileSync(PAD,'utf8'));
  const scope=require('./shared-paths-scope.cjs');
  for(const file of scope.files){const text=fs.readFileSync(file,'utf8');assert.strictEqual(scope.normalize(file,text),before(file));
    assert.strictEqual(scope.normalize(file,text+'\n// unknown neighboring edit\n'),text+'\n// unknown neighboring edit\n');}
  console.log('shared_paths_test: '+cases+' shared Play/Resume cases (54 before/after comparisons), coercion/order/return/errors; '+transitions+' production snapshot transitions; exact negative scope guards PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});

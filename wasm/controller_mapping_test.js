'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),cp=require('child_process');
const engine=fs.readFileSync('wasm/platform/controller-mapping.js','utf8');
const menu=fs.readFileSync('wasm/platform/controller-mapping-menu.js','utf8');
const publisher=fs.readFileSync('wasm/platform/gamepad.js','utf8');
function fixture(stored,legacy) {
 let value=stored,writes=0,frames=0,notified=0,raf,pads=[];
 const heap=new Int32Array(new SharedArrayBuffer(8192)),stride=49,count=197;
 const c={console,Int32Array,Float32Array,ArrayBuffer,Atomics,Set,Math,Number,Date,isFinite,Promise,
  isInGame:false,navigator:{getGamepads:()=>pads},performance:{now:()=>0},
  localStorage:{getItem(k){return k==='moonlight.controller-mapping.v2'?value:k==='moonlight.controller-mapping.v1'?legacy:null;},setItem(k,v){assert.strictEqual(k,'moonlight.controller-mapping.v2');value=v;writes++;}},
  addEventListener(){},
  document:new Proxy({},{get(){throw Error('unexpected DOM at load');}}),
  requestAnimationFrame(fn){frames++;raf=fn;return 1;},cancelAnimationFrame(){raf=null;},
  setTimeout(){throw Error('unexpected timer');},clearTimeout(){},
  Module:{HEAP32:heap,_gamepadSnapshotAddress:()=>64,_gamepadSnapshotMaxPads:()=>4,
   _gamepadSnapshotButtonCount:()=>17,_gamepadSnapshotStride:()=>stride*4,_gamepadSnapshotWordCount:()=>count,
   _notifyGamepadSnapshot(){notified++;},_resetRumbleState(){}}};
 c.window=c;vm.createContext(c);vm.runInContext(publisher,c);
 c.addEventListener=()=>{throw Error('unexpected mapping listener at load');};
 vm.runInContext(engine,c);
 assert.strictEqual(frames,0);assert.strictEqual(writes,0);
 return {c,heap,m:c.ControllerMapping,setPads(v){pads=v;},tick(){raf();},
  notifications:()=>notified,writes:()=>writes,stored:()=>value};
}
function pad(index=0,id='Synthetic standard controller') {
 return {index,id,connected:true,timestamp:1,axes:[-.13,.25,0,1],
  buttons:Array.from({length:17},()=>({value:0,pressed:false}))};
}
const XBOX='Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const PS='Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
const SWITCH='Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)';
let f=fixture(),cfg=f.m.get();
assert.strictEqual(cfg.version,2);assert(f.m.valid(cfg));
for(const family of ['xbox','playstation','nintendo'])assert.deepStrictEqual(Array.from(cfg.profiles[family].map),Array.from({length:17},(_,i)=>i));
assert.strictEqual(f.m.assign(cfg,'xbox',0,1),true);assert.strictEqual(cfg.profiles.xbox.map[0],1);assert.strictEqual(cfg.profiles.xbox.map[1],0);
assert.strictEqual(f.m.assign(cfg,'playstation',6,7),true);assert.strictEqual(cfg.profiles.playstation.map[6],7);
assert.strictEqual(f.m.assign(cfg,'nintendo',0,6),false,'no digital/trigger crossing');
assert.strictEqual(f.m.assign(cfg,'nintendo',16,0),false,'Guide is fixed');
assert.strictEqual(f.m.assign(cfg,'nintendo',0,99),false);
assert.strictEqual(f.m.reset(cfg,'xbox'),true);assert.deepStrictEqual(Array.from(cfg.profiles.xbox.map),Array.from({length:17},(_,i)=>i));
assert(f.m.save(cfg));assert.strictEqual(f.writes(),1);
const saved=f.m.get();saved.profiles.nintendo.map[0]=1;assert.strictEqual(f.m.get().profiles.nintendo.map[0],0,'get copies profiles');
const legacyMap=Array.from({length:17},(_,i)=>i);[legacyMap[0],legacyMap[1]]=[1,0];
const migrated=fixture(null,JSON.stringify({version:1,enabled:true,map:legacyMap})).m.get();
for(const family of ['xbox','playstation','nintendo'])assert.deepStrictEqual(Array.from(migrated.profiles[family].map),legacyMap);
const disabled=fixture(null,JSON.stringify({version:1,enabled:false,map:legacyMap})).m.get();
assert.deepStrictEqual(Array.from(disabled.profiles.xbox.map),Array.from({length:17},(_,i)=>i));
const badMaps=['bad json','null','{}','{"version":2,"profiles":{}}'];
for(const value of badMaps)assert.deepStrictEqual(Array.from(fixture(value).m.get().profiles.xbox.map),Array.from({length:17},(_,i)=>i),'invalid stored data falls back to defaults');
f=fixture();f.c._gpButtonCount=17;const original=f.c._gpBuildSnapshot;
assert.strictEqual(f.m.prepareSession(),false);assert.strictEqual(f.m.sessionBuilder(original),original,'identity has no wrapper');
cfg=f.m.defaults();f.m.assign(cfg,'xbox',0,1);assert(f.m.save(cfg));assert.strictEqual(f.m.prepareSession(),true);
f.m.prepareSession();f.setPads([pad(0,XBOX)]);f.c.startGamepadSnapshot(false);
let builder=f.m.sessionBuilder(f.c._gpBuildSnapshot);
let p=pad(0,XBOX);p.buttons[0].pressed=true;p.buttons[0].value=1;f.c._gpBuildSnapshot([p]);
const before=Array.from(f.c._gpNextWords);builder([p]);
assert.notDeepStrictEqual(Array.from(f.c._gpNextWords),before,'Xbox profile applied');
f.c.stopGamepadSnapshot();

// Each family must use its own profile in the same snapshot.
f=fixture();cfg=f.m.defaults();
f.m.assign(cfg,'xbox',0,1);f.m.assign(cfg,'playstation',2,3);f.m.assign(cfg,'nintendo',4,5);
assert(f.m.save(cfg));assert(f.m.prepareSession());
const pads=[pad(0,XBOX),pad(1,PS),pad(2,SWITCH)];f.setPads(pads);f.c.startGamepadSnapshot(false);
builder=f.m.sessionBuilder(f.c._gpBuildSnapshot);
for(const item of pads){for(let b=0;b<17;b++){item.buttons[b].value=0;item.buttons[b].pressed=false;}item.buttons[item.index===0?0:item.index===1?2:4].pressed=true;item.buttons[item.index===0?0:item.index===1?2:4].value=1;}
f.c._gpBuildSnapshot(pads);const raw=Array.from(f.c._gpNextWords);builder(pads);
const expected=raw.slice();
const maps={1:cfg.profiles.xbox.map,2:cfg.profiles.playstation.map,3:cfg.profiles.nintendo.map};
for(let slot=0;slot<3;slot++){
 const off=1+49*slot,analog=off+15,pressed=analog+17,type=slot+1;
 for(let s=0;s<17;s++){expected[analog+maps[type][s]]=raw[analog+s];expected[pressed+maps[type][s]]=raw[pressed+s];}
}
assert.deepStrictEqual(Array.from(f.c._gpNextWords),expected,'per-family maps applied by slot type');
f.c.stopGamepadSnapshot();

// Physical menu shortcuts remain reachable.
f=fixture();cfg=f.m.defaults();f.m.assign(cfg,'xbox',4,0);f.m.assign(cfg,'xbox',8,3);f.m.save(cfg);f.m.prepareSession();
const shortcutPad=pad(0,XBOX);f.setPads([shortcutPad]);f.c.startGamepadSnapshot(false);builder=f.m.sessionBuilder(f.c._gpBuildSnapshot);
for(const combo of [[8,9,4,5],[8,4,5,2]]){
 for(const b of shortcutPad.buttons){b.pressed=false;b.value=0;}
 for(const i of combo){shortcutPad.buttons[i].pressed=true;shortcutPad.buttons[i].value=1;}
 f.c._gpBuildSnapshot([shortcutPad]);const unchanged=Array.from(f.c._gpNextWords);builder([shortcutPad]);
 assert.deepStrictEqual(Array.from(f.c._gpNextWords),unchanged,'shortcut combos bypass custom mapping');
}
f.c._gpButtonCount=18;assert.strictEqual(f.m.sessionBuilder(f.c._gpBuildSnapshot),f.c._gpBuildSnapshot);
// Source guards remain exact around the mapping integration.
const scope=require('./controller-mapping-scope.cjs');
for(const file of ['wasm/platform/index.js','wasm/platform/navigation.js','wasm/platform/gamepad.js','wasm/index.html']) {
 const current=fs.readFileSync(file,'utf8'),old=cp.execFileSync('git',['show','9b6687e:'+file],{encoding:'utf8'});
 const expected=scope.legacy(file,old);
 assert.strictEqual(scope.normalize(file,current),expected,file+' approved mapping integration');
 assert.notStrictEqual(scope.normalize(file,current+'\n// unexpected change'),expected,'negative scope fixture');
}
for(const id of ['cm-family-xbox','cm-family-playstation','cm-family-nintendo','cm-hotspots','cm-targets','cm-analog-row','cm-analog-panel'])
 assert(menu.includes(id),'new editor '+id);
assert(!menu.includes('cm-rows'),'old dense assignment table removed');
console.log('controller_mapping_test: per-family profiles, validation, v1 migration, three-family snapshots, shortcuts and editor scope OK');

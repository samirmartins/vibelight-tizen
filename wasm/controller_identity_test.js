'use strict';
// Production browser snapshots and native sender; no real device or host.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),cp=require('child_process'),path=require('path'),os=require('os');
const prefix=fs.readFileSync('wasm/gamepad_snapshot_test.js','utf8').split('// A physical index hole')[0];
const identityScope=require('./controller-identity-scope.cjs');
for(const file of identityScope.files) {
 const text=fs.readFileSync(file,'utf8');
 assert.strictEqual(identityScope.normalize(file,text),cp.execFileSync('git',['show','0b77114:'+file],{encoding:'utf8'}));
 assert.strictEqual(identityScope.normalize(file,text+'\n// unexpected change\n'),text+'\n// unexpected change\n');
}
const out={};
vm.runInNewContext(prefix+`
 output.c=context;output.pad=pad;output.heap=heap32;output.listeners=listeners;
 output.tick=()=>rafCallback();output.pads=value=>{pads=value;};output.count=()=>notifications;
`,{require,console,output:out});
const c=out.c;
const cases=[
 ['DualSense Wireless Controller',2],['Sony DualShock 4',2],['Xbox Wireless Controller',1],['XInput Controller',1],
 ['Nintendo Switch Pro Controller',3],['Joy-Con (L)',3],['Pro Controller',3],
 ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',2],
 ['Generic (Vendor:045E Product:0B13)',1],['Generic (Vendor: 057e Product: 2009)',3],
 ['054c-0ce6-Wireless Controller',2],['045e:0b13',1],['057e-2009-Generic',3],
 ['HID\\VID_054C&PID_0CE6',2],['HID\\VID_045E&PID_0B13',1],['HID\\VID_057E&PID_2009',3],
 ['Pro Controller (Vendor: 045e Product: 0b13)',1],
 ['Generic Gamepad',0],['Generic 054c control',0],['Vendor: 054c0 Product: 0ce6',0],
 ['Product: 054c Vendor: 1234',0],['x054c-0ce6',0],['054c-xyz-Generic',0],['',0]
];
for(const [id,type] of cases)assert.strictEqual(c._gpControllerType({id}),type,id);
assert.strictEqual(c._gpControllerType(null),0);
let parses=0;const detect=c._gpControllerType;
c._gpControllerType=pad=>{parses++;return detect(pad);};
c.startGamepadSnapshot(false);out.tick();
const base=16+2,word=(slot,field)=>Atomics.load(out.heap,base+49*slot+field);
assert.strictEqual(word(0,4),2);const identity=word(0,3),n=out.count();
for(let i=0;i<1000;i++)out.tick();
assert.strictEqual(parses,1,'no per-frame name parsing');assert.strictEqual(out.count(),n);
const replacement={...out.pad,id:'045e-0b13-Wireless Controller',axes:[.25,-.5,0,0]};
const staleRumble=c._rumbleFailureHandler(0,c._rumbleAttempt[0],c._rumbleGeneration[0]);
out.pads([null,replacement]);out.tick();
assert.strictEqual(word(0,4),1);assert.notStrictEqual(word(0,3),identity);
staleRumble({name:'NotSupportedError'});assert.strictEqual(c._rumbleUnsupported[0],0,'old actuator failure cannot disable the new owner');
assert.strictEqual(parses,2);const replaced=word(0,3);
replacement.id='045e-02fd-Wireless Controller';out.tick();
assert.strictEqual(word(0,4),1);assert.notStrictEqual(word(0,3),replaced,'same-family replacement still changes identity');
const reconnect=word(0,3);
out.listeners.gamepaddisconnected.forEach(fn=>fn({gamepad:replacement}));
out.listeners.gamepadconnected.forEach(fn=>fn({gamepad:replacement}));out.tick();
assert.notStrictEqual(word(0,3),reconnect,'disconnect/reconnect between samples cannot disappear');
const pads=[replacement,...[3,5,7].map((index,i)=>({...out.pad,index,id:cases[i][0]}))];
out.pads([null,pads[0],null,pads[1],null,pads[2],null,pads[3]]);out.tick();
const others=[1,2,3].map(slot=>word(slot,3));
pads[0].id='057e-2009-Controller';out.tick();
assert.deepStrictEqual([1,2,3].map(slot=>word(slot,3)),others,'other logical slots retain identity');
c._gpConnectionForSlot[0]=0x7fffffff;pads[0].id='054c-0ce6-Controller';out.tick();
assert.strictEqual(word(0,3),1,'connection generation wraps without a zero sentinel');
c.stopGamepadSnapshot();

const native=fs.readFileSync('wasm/gamepad.cpp','utf8');
const fixture=`
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdint>
#include <algorithm>
#include <limits>
#include <string>
#include <vector>
#include <cassert>
#include <iostream>
#include "Limelight.h"
#define EMSCRIPTEN_KEEPALIVE
class MoonlightInstance {public:void PollGamepads();void HandleGamepadInputState(bool,bool);static void ClControllerRumble(unsigned short,unsigned short,unsigned short);};
void stopStream(){} void toggleStats(){} void PostToJs(std::string){}
int emscripten_futex_wake(void*,int){return 0;} int emscripten_futex_wait(void*,uint32_t,double){return 0;}
struct Event {int kind,id,mask,type,buttons,lt=0,rt=0,x=0,y=0,rx=0,ry=0;};
std::vector<Event> events;bool failArrival=false,failRelease=false;
extern "C" int LiSendControllerArrivalEvent(uint8_t id,uint16_t mask,uint8_t type,uint32_t,uint16_t caps){
 if(failArrival){failArrival=false;return -1;}events.push_back({1,id,mask,type,caps});return 0;
}
extern "C" int LiSendMultiControllerEvent(short id,short mask,int flags,unsigned char lt,unsigned char rt,short x,short y,short rx,short ry){
 if(failRelease&&!(mask&(1<<id))){failRelease=false;return -1;}events.push_back({2,id,mask,0,flags,lt,rt,x,y,rx,ry});return 0;
}
extern "C" int LiSendMouseMoveEvent(short,short){return 0;}
extern "C" int LiSendHScrollEvent(signed char){return 0;}
extern "C" int LiSendScrollEvent(signed char){return 0;}
extern "C" int LiSendMouseButtonEvent(char,int){return 0;}
`;
const body=native.replace(/^#include[^\n]*\n/gm,'');
const tests=`
void publish(MoonlightInstance& app,int owner,int type=2,bool second=false,int buttons=0,int secondOwner=1,int secondType=3) {
 GamepadSnapshot s{};s.numGamepads=4;s.pads[0].connected=owner!=0;s.pads[0].controllerType=type;
 std::memcpy(reinterpret_cast<char*>(&s.pads[0])+12,&owner,4);s.pads[0].numButtons=17;
 s.pads[0].capabilities=LI_CCAP_ANALOG_TRIGGERS|LI_CCAP_RUMBLE;
 s.pads[0].digitalButton[0]=buttons;
 s.pads[0].axis[0]=.125f;s.pads[0].axis[1]=-.5f;s.pads[0].axis[2]=.25f;s.pads[0].axis[3]=-.75f;
 s.pads[0].analogButton[6]=.25f;s.pads[0].analogButton[7]=.75f;
 if(second){s.pads[1]=s.pads[0];s.pads[1].connected=1;s.pads[1].digitalButton[0]=0;const int32_t other=secondOwner;std::memcpy(reinterpret_cast<char*>(&s.pads[1])+12,&other,4);s.pads[1].controllerType=secondType;}
 __atomic_add_fetch(&s_gpSharedWords[0],1,__ATOMIC_SEQ_CST);
 const auto* words=reinterpret_cast<const uint32_t*>(&s);
 for(size_t i=0;i<sizeof(s)/4;i++)__atomic_store_n(&s_gpSharedWords[i+1],words[i],__ATOMIC_RELAXED);
 __atomic_add_fetch(&s_gpSharedWords[0],1,__ATOMIC_SEQ_CST);app.PollGamepads();
}
int main(int argc,char** argv) {
 MoonlightInstance app;app.HandleGamepadInputState(true,false);
 if(argc>1&&std::strcmp(argv[1],"replacement")==0){publish(app,1);auto n=events.size();publish(app,2);std::cout<<events.size()-n;return 0;}
 if(argc>1){
   for(int i=0;i<100;i++)publish(app,1,2,false,i%2);
   for(auto e:events)std::cout<<e.kind<<","<<e.id<<","<<e.mask<<","<<e.type<<","<<e.buttons<<","<<e.lt<<","<<e.rt<<","<<e.x<<","<<e.y<<","<<e.rx<<","<<e.ry<<";";
   return 0;
 }
 publish(app,1,2,true);assert(events.size()==4);assert(events[0].kind==1&&events[0].type==2);
 auto n=events.size();publish(app,1,2,true);assert(events.size()==n);
 publish(app,2,1,true);assert(events.size()==n+3);
 assert(events[n].kind==2&&events[n].id==0&&events[n].mask==2&&events[n].buttons==0);
 assert(events[n+1].kind==1&&events[n+1].id==0&&events[n+1].type==1);
 assert(events[n+2].kind==2&&events[n+2].id==0);
 n=events.size();publish(app,3,1,true);assert(events.size()==n+3 && "same-family owner is reannounced");
 // Per-controller ENet ordering does not order different controllers. Model the
 // host's inventory reset/arrival rules under every merge of two channels.
 app.HandleGamepadInputState(true,false);events.clear();publish(app,1,2,true);
 n=events.size();publish(app,2,1,true,0,2,3);assert(events.size()==n+6);
 std::vector<Event> channel[2];for(size_t i=n;i<events.size();++i)channel[events[i].id].push_back(events[i]);
 auto replay=[&](auto&& self,int a,int b,int first,int second)->void {
   if(a==3&&b==3){assert(first==1&&second==3);return;}
   for(int slot=0;slot<2;++slot){
     const int offset=slot==0?a:b;if(offset==3)continue;
     int types[2]={first,second};const auto& e=channel[slot][offset];
     if(e.kind==1){if(types[e.id]<0)types[e.id]=e.type;}
     else {for(int i=0;i<2;++i)if(!(e.mask&(1<<i)))types[i]=-1;
       if((e.mask&(1<<e.id))&&types[e.id]<0)types[e.id]=0;}
     self(self,a+(slot==0),b+(slot==1),types[0],types[1]);
   }
 };
 replay(replay,0,0,2,3);
 app.HandleGamepadInputState(true,false);events.clear();publish(app,3,1,true);
 // A failed release must not announce/input the new owner over the old device.
 n=events.size();failRelease=true;publish(app,4,3,true);assert(events.size()==n);
 app.PollGamepads();assert(events.size()==n);publish(app,4,3,true,1);assert(events.size()==n+3&&events[n+1].type==3);
 // Failed arrivals retry on the next changed snapshot, without an idle timer.
 n=events.size();failArrival=true;publish(app,5,2,true);assert(events.size()==n+1);
 assert(!InputNeedsTimedWake());app.PollGamepads();assert(events.size()==n+1);
 publish(app,5,2,true,1);assert(events.size()==n+3);
 n=events.size();app.PollGamepads();assert(events.size()==n);
 publish(app,0,2,true);n=events.size();publish(app,6,2,true);assert(events.size()==n+2);
 app.HandleGamepadInputState(false,false);events.clear();publish(app,6,2,true);
 assert(events[0].kind==1&&!(events[0].buttons&LI_CCAP_RUMBLE));
 std::cout<<"controller identity native: ordered release/arrival, two slots, same-family replacement, failed enqueue, idle and rumble OFF PASS\\n";
}
`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'controller-identity-'));
try {
 const build=(name,text)=>{
  const file=path.join(temp,name+'.cpp'),bin=path.join(temp,name);
  fs.writeFileSync(file,fixture+text.replace(/^#include[^\n]*\n/gm,'')+tests);
  cp.execFileSync('g++',['-std=c++17','-O1','-g','-pthread','-fsanitize=address,undefined','-fno-omit-frame-pointer','-Imoonlight-common-c/src',file,'-o',bin],{stdio:'pipe'});
  return bin;
 };
 const bin=build('current',body);
 cp.execFileSync(bin,[],{stdio:'inherit'});
 const unsafe=build('cross-channel-negative',body.replace('const short retainedMask = activeGamepadMask & ~bit;',
   'const short retainedMask = activeGamepadMask & ~replacedMask;'));
 assert.notStrictEqual(cp.spawnSync(unsafe,[],{stdio:'pipe'}).status,0,'negative control must detect retirement of another channel owner');
 const old=cp.execFileSync('git',['show','0b77114:wasm/gamepad.cpp'],{encoding:'utf8'});
 const baseline=build('baseline',old);
 assert.strictEqual(cp.execFileSync(bin,['healthy'],{encoding:'utf8'}),cp.execFileSync(baseline,['healthy'],{encoding:'utf8'}),'healthy input event trace matches previous code exactly');
 assert.strictEqual(cp.execFileSync(baseline,['replacement'],{encoding:'utf8'}),'0','baseline misses same-family replacement');
 assert.strictEqual(cp.execFileSync(bin,['replacement'],{encoding:'utf8'}),'3','replacement releases, announces and resends current state');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
console.log('controller_identity_test: vendor/name recognition, replacement/reconnect, cached parsing, native ordering and unchanged healthy trace OK');

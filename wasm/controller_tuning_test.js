'use strict';
// Real tuning module and native shaping. Synthetic snapshots only; no TV.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const cp = require('child_process'), path = require('path'), os = require('os');

function jsFixture(stored) {
  let value = stored === undefined ? null : stored, writes = 0, calls = [];
  const c = {
    console: {log() {}, warn() {}, error() {}},
    JSON, Object, Math, Number, String, isFinite,
    isInGame: false,
    localStorage: {
      getItem() { return value; },
      setItem(key, next) { assert.strictEqual(key, 'moonlight.controller-tuning.v1'); value = next; writes++; }
    },
    Module: {_configureGamepadTuning(...args) { calls.push(args); }}
  };
  const documentProxy = new Proxy({}, {get() { throw Error('unexpected DOM at load'); }});
  c.document = documentProxy;
  c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/controller-tuning.js', 'utf8'), c);
  return {c, writes: () => writes, calls: () => calls, stored: () => value};
}

{
  let f = jsFixture();
  let cfg = f.c.ControllerTuning.get();
  assert.strictEqual(cfg.enabled, false);
  assert.strictEqual(cfg.deadzone, 0);
  assert.strictEqual(cfg.curve, 1);
  assert(f.c.ControllerTuning.valid(cfg));
  cfg.deadzone = 0.1;
  assert.strictEqual(f.c.ControllerTuning.get().deadzone, 0, 'get returns a copy');

  for (const bad of [
    'bad json', 'null', '{}', '{"version":2,"enabled":true,"deadzone":0,"curve":1,"invertLeft":0,"invertRight":0,"swapSticks":false,"triggerThreshold":0}',
    '{"version":1,"enabled":true,"deadzone":0.6,"curve":1,"invertLeft":0,"invertRight":0,"swapSticks":false,"triggerThreshold":0}',
    '{"version":1,"enabled":true,"deadzone":0,"curve":0.4,"invertLeft":0,"invertRight":0,"swapSticks":false,"triggerThreshold":0}',
    '{"version":1,"enabled":true,"deadzone":0,"curve":1,"invertLeft":4,"invertRight":0,"swapSticks":false,"triggerThreshold":0}',
    '{"version":1,"enabled":true,"deadzone":0,"curve":1,"invertLeft":0,"invertRight":0,"swapSticks":false,"triggerThreshold":0.6}'
  ]) assert.strictEqual(jsFixture(bad).c.ControllerTuning.get().enabled, false, bad);

  cfg = f.c.ControllerTuning.defaults();
  cfg.enabled = true;
  cfg.deadzone = 0.1;
  cfg.curve = 1.5;
  cfg.invertLeft = 1;
  cfg.invertRight = 2;
  cfg.swapSticks = true;
  cfg.triggerThreshold = 0.1;
  assert(f.c.ControllerTuning.save(cfg));
  assert.strictEqual(f.writes(), 1);
  assert(f.c.ControllerTuning.configureSession());
  assert.deepStrictEqual(f.calls()[0], [1, 100, 150, 1, 2, 1, 100]);
  cfg.deadzone = 0;
  assert.strictEqual(f.c.ControllerTuning.get().deadzone, 0.1, 'save copies');

  f = jsFixture(f.stored());
  assert(f.c.ControllerTuning.get().enabled, 'reload restores the opt-in response');
  f.c.isInGame = true;
  assert(!f.c.ControllerTuning.save(f.c.ControllerTuning.defaults()), 'cannot save during a stream');
  f.c.isInGame = false;
  const previous = f.stored();
  f.c.localStorage.setItem = () => { throw Error('quota'); };
  assert(!f.c.ControllerTuning.save(f.c.ControllerTuning.defaults()));
  assert.strictEqual(f.stored(), previous, 'failed storage keeps the previous values');

  const source = fs.readFileSync('wasm/platform/controller-tuning.js', 'utf8');
  assert(!/setTimeout|setInterval|requestAnimationFrame|document\.|console\./.test(source), 'no timer, frame loop, DOM or logs');
}

{
  const menu = fs.readFileSync('wasm/platform/controller-mapping-menu.js', 'utf8');
  for (const id of ['cm-tuning-enabled', 'cm-deadzone', 'cm-curve', 'cm-invert-left',
    'cm-invert-right', 'cm-swap-sticks', 'cm-trigger-threshold']) assert(menu.includes(id), id);
  assert(menu.includes('ControllerTuning.save(tuning)'), 'editor saves the analog response');
  const index = fs.readFileSync('wasm/platform/index.js', 'utf8');
  const start = index.slice(index.indexOf('function startGame('), index.indexOf('// Stop the running app title'));
  assert(start.includes('ControllerTuning.configureSession()'), 'one native configuration before startRequest');
  assert((start.match(/ControllerTuning\.configureSession\(\)/g) || []).length === 1, 'configured once, not per path');
  assert(fs.readFileSync('wasm/index.html', 'utf8').includes('platform/controller-tuning.js'));
}

function nativeFixture() {
  const native = fs.readFileSync('wasm/gamepad.cpp', 'utf8');
  const fixture = `
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
void PostToJsAsync(const std::string&){}
int emscripten_futex_wake(void*,int){return 0;} int emscripten_futex_wait(void*,uint32_t,double){return 0;}
struct Event {int kind,id,mask,type,buttons,lt=0,rt=0,x=0,y=0,rx=0,ry=0;};
std::vector<Event> events;
extern "C" int LiSendControllerArrivalEvent(uint8_t id,uint16_t mask,uint8_t type,uint32_t,uint16_t caps){events.push_back({1,id,mask,type,caps});return 0;}
extern "C" int LiSendMultiControllerEvent(short id,short mask,int flags,unsigned char lt,unsigned char rt,short x,short y,short rx,short ry){events.push_back({2,id,mask,0,flags,lt,rt,x,y,rx,ry});return 0;}
extern "C" int LiSendMouseMoveEvent(short,short){return 0;} extern "C" int LiSendHScrollEvent(signed char){return 0;}
extern "C" int LiSendScrollEvent(signed char){return 0;} extern "C" int LiSendMouseButtonEvent(char,int){return 0;}
`;
  const body = native.replace(/^#include[^\n]*\n/gm, '');
  const tests = `
void publish(MoonlightInstance& app,float lx,float ly,float rx,float ry,float lt,float rt) {
 GamepadSnapshot s{};s.numGamepads=4;s.pads[0].connected=1;s.pads[0].controllerType=2;
 const int32_t owner=1;std::memcpy(reinterpret_cast<char*>(&s.pads[0])+12,&owner,4);s.pads[0].numButtons=17;
 s.pads[0].capabilities=LI_CCAP_ANALOG_TRIGGERS|LI_CCAP_RUMBLE;
 s.pads[0].axis[0]=lx;s.pads[0].axis[1]=ly;s.pads[0].axis[2]=rx;s.pads[0].axis[3]=ry;
 s.pads[0].analogButton[6]=lt;s.pads[0].analogButton[7]=rt;
 __atomic_add_fetch(&s_gpSharedWords[0],1,__ATOMIC_SEQ_CST);
 const auto* words=reinterpret_cast<const uint32_t*>(&s);
 for(size_t i=0;i<sizeof(s)/4;i++)__atomic_store_n(&s_gpSharedWords[i+1],words[i],__ATOMIC_RELAXED);
 __atomic_add_fetch(&s_gpSharedWords[0],1,__ATOMIC_SEQ_CST);app.PollGamepads();
}
Event last() { return events.back(); }
void healthy(MoonlightInstance& app) {
 publish(app,.5f,-.25f,.8f,-.9f,.2f,.8f);
 Event p=last();std::cout<<p.lt<<","<<p.rt<<","<<p.x<<","<<p.y<<","<<p.rx<<","<<p.ry;
}
int main(int argc,char** argv) {
 MoonlightInstance app;app.HandleGamepadInputState(true,false);
 if(argc>1&&std::strcmp(argv[1],"healthy")==0){healthy(app);return 0;}
 publish(app,.5f,-.25f,.8f,-.9f,.2f,.8f);
 Event base=last();
 assert(base.lt==51&&base.rt==204&&base.x==16384&&base.y==8192&&base.rx==26214&&base.ry==29490);
 configureGamepadTuning(1,100,100,0,0,0,0);
 publish(app,.5f,-.25f,.8f,-.9f,.2f,.8f);
 Event dead=last();
 assert(dead.x<base.x&&dead.x>0);assert(dead.y<base.y&&dead.y>0);
 assert(dead.rx<base.rx&&dead.ry<base.ry);
 assert(dead.lt==base.lt&&dead.rt==base.rt);
 publish(app,.05f,-.25f,.8f,-.9f,.2f,.8f);
 assert(last().x==0);
 configureGamepadTuning(1,0,200,0,0,0,0);
 publish(app,.5f,-.25f,.8f,-.9f,.2f,.8f);
 assert(last().x==8192);
 configureGamepadTuning(1,0,100,1,0,0,0);
 publish(app,.5f,-.25f,.8f,-.9f,.2f,.8f);
 assert(last().x==-16384);
 configureGamepadTuning(1,0,100,0,0,1,0);
 publish(app,.5f,-.25f,.8f,-.9f,.2f,.8f);
 assert(last().x==26214&&last().rx==16384);
 configureGamepadTuning(1,0,100,0,0,0,500);
 publish(app,.5f,-.25f,.8f,-.9f,.2f,.8f);
 assert(last().lt==0&&last().rt==153);
 configureGamepadTuning(0,0,100,0,0,0,0);
 publish(app,.5f,-.25f,.8f,-.9f,.2f,.8f);
 Event off=last();
 assert(off.lt==base.lt&&off.rt==base.rt&&off.x==base.x&&off.y==base.y&&off.rx==base.rx&&off.ry==base.ry);
 std::cout<<"controller tuning native: neutral identity, deadzone, curve, invert, swap, trigger threshold and disabled reset PASS\\n";
}
`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-tuning-'));
  try {
    const build = (name, text) => {
      const file = path.join(temp, name + '.cpp'), bin = path.join(temp, name);
      fs.writeFileSync(file, fixture + text.replace(/^#include[^\n]*\n/gm, '') + tests);
      cp.execFileSync('g++', ['-std=c++17', '-O1', '-g', '-pthread', '-fsanitize=address,undefined',
        '-fno-omit-frame-pointer', '-Imoonlight-common-c/src', file, '-o', bin], {stdio: 'pipe'});
      return bin;
    };
    const bin = build('current', body);
    cp.execFileSync(bin, [], {stdio: 'inherit'});
    const old = cp.execFileSync('git', ['show', 'a434117:wasm/gamepad.cpp'], {encoding: 'utf8'});
    const baseline = build('baseline', old + '\nextern "C" void configureGamepadTuning(int,int,int,int,int,int,int) {}\n');
    assert.strictEqual(cp.execFileSync(bin, ['healthy'], {encoding: 'utf8'}),
      cp.execFileSync(baseline, ['healthy'], {encoding: 'utf8'}),
      'disabled tuning keeps the previous native event exactly');
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}

nativeFixture();
console.log('controller_tuning_test: validation, opt-in persistence, one native configure, exact neutral path and native deadzone/curve/invert/swap/threshold PASS');

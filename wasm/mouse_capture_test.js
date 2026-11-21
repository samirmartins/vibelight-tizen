'use strict';
// Compile the real DOM input handlers. Browser notifications and host transport
// are boundaries; this does not simulate the Samsung decoder or prove TV behavior.
const fs=require('fs'),cp=require('child_process'),os=require('os'),path=require('path'),assert=require('assert');
let fixture=fs.readFileSync('wasm/fixtures/input-stubs.cpp','utf8');
assert(fixture.includes('\n#include'));
fixture=fixture.replace('extern "C" void LiRequestIdrFrame(void) {}','int idrs=0,locks=0;\nextern "C" void LiRequestIdrFrame(void) { ++idrs; }')
 .replace('void emscripten_request_pointerlock(const char*, bool) {}','void emscripten_request_pointerlock(const char*, bool) { ++locks; }');
const tests=`
int main() {
 MoonlightInstance app;g_Instance=&app;
 app.m_MouseLocked=false;
 EmscriptenMouseEvent mouse;mouse.movementX=4;mouse.movementY=-3;
 EmscriptenPointerlockChangeEvent acquired{true},lost{false};
 // The capture click belongs to the TV. It must not request video work or
 // send an orphan button-up to the PC after consuming the button-down.
 app.HandleMouseDown(mouse);assert(locks==1&&!app.m_MouseLocked&&events.empty());
 handlePointerLockChange(0,&acquired,nullptr);
 assert(app.m_MouseLocked&&idrs==0);
 app.HandleMouseUp(mouse);assert(events.empty());
 app.HandleMouseMove(mouse);app.ReportMouseMovement();
 assert(events.size()==1&&events[0].type==2&&events[0].code==4&&events[0].action==-3);
 app.HandleMouseDown(mouse);app.HandleMouseUp(mouse);
 assert(events.size()==3&&events[1].action==BUTTON_ACTION_PRESS&&events[2].action==BUTTON_ACTION_RELEASE);
 const auto size=events.size();app.HandleMouseUp(mouse);assert(events.size()==size);
 // Repeated acquisition, real release, re-acquisition and a late notification
 // after stop must never turn a UI event into an unsolicited keyframe request.
 for(int i=0;i<100;i++)handlePointerLockChange(0,&acquired,nullptr);
 assert(idrs==0);
 handlePointerLockChange(0,&lost,nullptr);assert(!app.m_MouseLocked);
 app.HandleMouseMove(mouse);app.ReportMouseMovement();assert(events.size()==size);
 app.HandleMouseDown(mouse);handlePointerLockChange(0,&acquired,nullptr);app.HandleMouseUp(mouse);
 assert(events.size()==size&&idrs==0);
 app.HandleMouseDown(mouse);handlePointerLockChange(0,&lost,nullptr);
 assert(events.size()==size+2&&app.m_HeldMouseButtons.none());
 app.m_Running=false;handlePointerLockChange(0,&acquired,nullptr);assert(idrs==0);
 // Keyboard-first preserves the same capture and mouse packet semantics.
 events.clear();app.m_Running=true;app.m_MouseLocked=false;
 EmscriptenKeyboardEvent key;key.keyCode=0x41;
 app.SendKeyboardInput(key.keyCode,KEY_ACTION_DOWN,0);app.SendKeyboardInput(key.keyCode,KEY_ACTION_UP,0);
 assert(events.size()==2);
 app.HandleMouseDown(mouse);handlePointerLockChange(0,&acquired,nullptr);app.HandleMouseUp(mouse);
 app.HandleMouseMove(mouse);app.ReportMouseMovement();
 assert(events.size()==3&&events.back().type==2&&idrs==0);
 handlePointerLockError(5,nullptr,nullptr);assert(!app.m_MouseLocked&&idrs==0);
}
`;
const source=fs.readFileSync('wasm/input.cpp','utf8').replace('#include "moonlight_wasm.hpp"','');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moonlight-mouse-capture-'));
try{
 const file=path.join(dir,'test.cpp'),bin=path.join(dir,'test');fs.writeFileSync(file,fixture+source+tests);
 cp.execFileSync('g++',['-std=c++17','-O1','-g','-fsanitize=address,undefined','-fno-omit-frame-pointer','-Imoonlight-common-c/src',file,'-o',bin],{stdio:'inherit'});
 cp.execFileSync(bin,[],{stdio:'inherit',env:{...process.env,ASAN_OPTIONS:'detect_leaks=1',UBSAN_OPTIONS:'halt_on_error=1'}});
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('mouse_capture_test: first click, paired buttons, movement, repeated/reacquired/late capture and keyboard-first; zero input-induced IDR requests PASS');

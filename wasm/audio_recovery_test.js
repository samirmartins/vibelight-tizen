'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
function fixture(mode,inject) {
 let Processor,armed=false,fired=false,seenPcmAfterAck=false,acked=false;
 const memory=new SharedArrayBuffer(4096),control=new Int32Array(memory,0,18),pcm=new Int16Array(memory,128,1024);
 pcm.fill(12000);control[1]=400;control[2]=7;control[3]=mode;control[6]=control[13]=4;control[14]=480;
 const atomics=new Proxy(Atomics,{get(target,name){const fn=target[name];if(typeof fn!=='function')return fn;
  return function(array,index,value,...rest){
   if(armed&&!fired&&name==='store'&&index===0){fired=true;inject(control);}
   if(name==='store'&&index===16)acked=true;
   return fn.call(target,array,index,value,...rest);
  };
 }});
 const c={AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor:(n,p)=>Processor=p,
  sampleRate:48000,Atomics:atomics,window:{},console,performance:{now:()=>0},setTimeout,clearTimeout};vm.createContext(c);
 vm.runInContext(fs.readFileSync('wasm/platform/audio-worklet.js','utf8'),c);
 vm.runInContext(fs.readFileSync('wasm/platform/audio.js','utf8'),c);
 c._audControl=control;c._audPcm=pcm;c._audGeneration=7;c._audCapacityFrames=512;c._audChannels=2;c._audSourceRate=48000;
 const p=new Processor();p.port.onmessage({data:{type:'init',memory,controlPtr:0,pcmPtr:128,capacityFrames:512,channels:2,sourceRate:48000,generation:7}});
 function run() {const out=[new Float32Array(128),new Float32Array(128)];
  if(mode===1)p.process([], [out]);else c._audProcessFallback({outputBuffer:{length:128,sampleRate:48000,numberOfChannels:2,getChannelData:i=>out[i]}});
  return out;
 }
 return {c,p,control,run,arm(){armed=true;},fired:()=>fired};
}
if(!process.argv.includes('--ownership')) for(const mode of [1,2]) {
 const f=fixture(mode,c=>{Atomics.store(c,15,400);Atomics.add(c,12,1);});
 f.arm();f.run();assert(f.fired());
 const out=f.run();assert(out.every(ch=>ch.every(v=>v===0)),'reset quantum is silent');
 assert.equal(f.control[0],400,'consumer applies reset after completing old quantum');
 assert.equal(f.control[16],f.control[12],'ACK published after reset');
 // A pending request before consumer initialization must also be honored.
 f.control[15]=450;f.control[12]++;assert(f.run()[0].every(v=>v===0));assert.equal(f.control[0],450);
}
console.log('audio_recovery_test: overflow during quantum, delayed reset, ACK and silence in both consumers OK');

for(const mode of [1,2]) {
 const f=fixture(mode,c=>{
  Atomics.or(c,17,4);
  if(!(Atomics.load(c,17)&3)){c[2]=8;c[0]=0;c[1]=50;}
 });
 f.arm();f.run();assert(f.fired());
 assert.equal(f.control[2],7,'native retirement must retain storage until callback exits');
 assert.equal(f.control[17],4,'callback releases ownership while preserving retirement');
 f.control[2]=8;f.control[0]=0;f.control[1]=50;f.control[17]=0;
 if(mode===1){assert(f.run()[0].every(v=>v===0));assert.equal(f.control[0],0,'retired worklet cannot modify new generation');}
}
console.log('audio_recovery_test: callbacks crossing native retirement require quiescence before reuse OK');

{
 const f=fixture(1,()=>{});f.c._audResetStats();
 const ctx={destination:{maxChannelCount:2},state:'running',sampleRate:48000,
  createScriptProcessor(){
   assert.equal(f.control[17],8,'backend handoff holds ownership before publishing fallback');
   Atomics.or(f.control,17,4);
   return {connect(){},disconnect(){}};
  }};
 f.c._audActivateFallback(ctx,f.c._audConfigToken);
 assert.equal(f.control[17],4,'handoff preserves concurrent native retirement');
}
console.log('audio_recovery_test: worklet-to-fallback handoff cannot reopen retired storage OK');

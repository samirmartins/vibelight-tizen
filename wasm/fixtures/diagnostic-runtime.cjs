'use strict';
const fs=require('fs'),vm=require('vm');
module.exports=function fixture(debug=false) {
 let now=0,next=0; const timers=new Map(),frames=new Map(),listeners=new Map(),storage=new Map();
 const generations=[],events=[],nodes={};
 const video={drops:40,requestVideoFrameCallback(fn){frames.set(++next,fn);return next;},
  cancelVideoFrameCallback(id){frames.delete(id);},addEventListener(k,f){listeners.set(k,f);},
  removeEventListener(k){listeners.delete(k);},getVideoPlaybackQuality(){return{droppedVideoFrames:this.drops};}};
 const element=id=>nodes[id]||(nodes[id]={checked:false,textContent:'',value:'',appendChild(){}});
 nodes.wasm_module=video;
 const c={console,Date,Math,JSON,isFinite,Uint32Array,performance:{now:()=>now},isInGame:true,isDialogOpen:false,
  appInfo:{version:'4.0.2'},modelName:'Synthetic TV',platformVer:'9.0',
  document:{getElementById:element,createElement:()=>({appendChild(){}})},
  Module:{setDiagnostics:g=>generations.push(g)},setTimeout(fn){timers.set(++next,fn);return next;},
  clearTimeout(id){timers.delete(id);},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  snackbarLogLong:message=>events.push(message),openUtilityDialog(){},closeUtilityDialog(){},
  tizen:{systeminfo:{getAvailableMemory(){events.push('memory');return 104857600;},
   getPropertyValue(k,fn){events.push('cpu');fn({load:.2});}}},
  XMLHttpRequest:function(){this.open=(method,url)=>{if(url!=='config.xml')throw Error('remote stats request');};
   this.send=()=>{this.responseText='';this.onload();};this.abort=()=>{};},
  _audRefreshStats(){},setAudioTelemetryEnabled(name,value){events.push(name+':'+value);},
  _mlAudioStats:{started:true,backend:'AudioWorklet',depthMs:20,targetMs:20,underruns:3,overruns:0}};
 c.window=c;vm.createContext(c);
 for(const file of ['diagnostic-history.js','diagnostics.js']) {
  const filename='wasm/platform/'+file;
  if(fs.existsSync(filename)){
   let source=fs.readFileSync(filename,'utf8');
   if(debug && file==='diagnostics.js')source=source.replace('start:start,connected:connected,','_debug:function(){return session;},start:start,connected:connected,');
   vm.runInContext(source,c,{filename});
  }
 }
 const sample=(gen,extra={})=>JSON.stringify(Object.assign({gen,ms:2000,w:1920,h:1080,fmt:1,fps:60,
  bytes:7500000,rx:120,sub:118,total:120,lost:2,rej:1,rec:0,rtt:3,rttVar:1,hostN:120,hostLate:1,
  hostMean:16.667,hostP95:18,enc:4,encMax:8,asm:.6,asmP95:1,asmMax:1.4,
  app:.8,appP95:1.2,appMax:2,cadN:118,cadLate:2,cadP95:20,cadMax:36,
  leadN:120,lead:-5,leadAbsMax:12,filtered:-3,target:0,servo:0,settle:1800,clockAge:100,step:16.667},extra));
 return{c,d:c.SessionDiagnostics,nodes,storage,timers,frames,listeners,generations,events,video,sample,
  advance(ms){now+=ms;},frame(at,count){const [id,fn]=[...frames][0];frames.delete(id);fn(at,{expectedDisplayTime:at,presentedFrames:count});},
  tick(){const [id,fn]=[...timers][0];timers.delete(id);now+=2000;fn();}};
};

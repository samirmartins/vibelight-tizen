// Shared harness: production startup/menu code with a fake DOM, storage,
// timers and host replies. Run as a script prefix (VM or same scope).
'use strict';
// Run the real launcher with bounded synthetic DOM, PC, clock and audio inputs.
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('wasm/platform/console-library.js','utf8');
function fixture(options={}) {
 const nodes=new Map(),timers=new Map(),launched=[],calls={connect:0,list:0,wake:0,audio:0,close:0};let timerId=0;
 function node(name) {
  if(!nodes.has(name))nodes.set(name,{id:name,disabled:false,hidden:false,checked:false,style:{},children:[],dataset:{},textContent:'',classList:{add(){},remove(){},toggle(){}},
   setAttribute(){},appendChild(n){this.children.push(n);},querySelector(){return node('image');},scrollIntoView(){},click(){if(this.disabled)return;this.checked=!this.checked;if(this.onchange)this.onchange();else if(this.onclick)this.onclick();}});
  return nodes.get(name);
 }
 const apps=[{id:1,title:'Playnite'},{id:2,title:'Example Game'}];
 const record={apps,favorites:[],recent:[],focus:2,...options.record};
 let stored=JSON.stringify({preferred:'fixture-pc',hosts:{'fixture-pc':record}});
 const storage=new Map([['moonlight.console.v1',stored]]);
 const host={serverUid:'fixture-pc',hostname:'Fixture PC',online:options.online!==false,paired:options.paired!==false,currentGame:options.current||0,macAddress:options.noMac?'':'12:34:56:78:9A:BC',_memCachedApplist:apps,
  connect(){calls.connect++; if(options.delayed)return new Promise(r=>host.resolve=r);return host.online?Promise.resolve('fixture.invalid'):Promise.reject(Error('offline'));},
  getAppListWithCacheFlush(){calls.list++;return Promise.resolve(options.missing?[apps[1]]:apps);},
  refreshServerInfo(){return Promise.resolve();},
  getBoxArt(){return Promise.resolve('fixture');},
  sendWOL(){calls.wake++;if(options.wakeDelayed)return new Promise(r=>host.resolveWake=r);if(options.wakeFailure)return Promise.reject(Error('send failed'));if(!options.stayOffline)host.online=true;return Promise.resolve();}};
 const c={console:{log(){},warn(){},error(){}},Promise,hosts:{'fixture-pc':host},isInGame:false,isDialogOpen:false,Views:{Apps:{},AppsNav:{}},
  localStorage:{getItem(k){return storage.has(k)?storage.get(k):null;},removeItem(k){storage.delete(k);},setItem(k,v){storage.set(k,v);if(k==='moonlight.console.v1')stored=v;}},
  setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);},
  document:{getElementById:node,body:node('body'),createDocumentFragment(){return node('fragment-'+nodes.size);},createElement(){return node('created-'+nodes.size);}},
  $(){return {children(){return this;},show(){},hide(){}};},
  Navigation:{change(){},start(){},pop(){}},focusElement(){},showAppsMode(){},stopPollingHosts(){},stopSubnetScanner(){},showHosts(){},
  getComputedStyle(){return {gridTemplateColumns:'1fr 1fr'};},
  normalizeWakeMac(v){return v;},prepareStreamAudio(){calls.audio++;c._mlAudioCtx={state:options.audioBlocked?'suspended':'running',resume(){return new Promise(()=>{});}};},
  stopAudioScheduler(close){if(close&&c._mlAudioCtx){calls.close++;c._mlAudioCtx=null;}},
  startGame(h,app,audio){launched.push({app,audio});c.isInGame=true;c.ConsoleLibrary.suspend();},
  WakeHost:{open(){}},hostChosen(){},snackbarLog(){},exitAppDialog(){}};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('wasm/platform/menu-tools.js','utf8').split('function openUtilityDialog')[0],c);
 vm.runInContext(source,c);
 const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
 async function tick(ms) {
  const entry=Array.from(timers.entries()).find(([id,t])=>t.ms===ms);
  assert(entry,'Missing timer '+ms);timers.delete(entry[0]);entry[1].fn();await flush();
 }
 return {c,node,host,timers,calls,launched,flush,tick,prefs:()=>JSON.parse(stored).hosts['fixture-pc']};
}

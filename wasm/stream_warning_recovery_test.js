'use strict';
// Execute the production warning/menu-return handlers with synthetic DOM/native
// boundaries. A warning must own one view and preserve the deferred menu return.
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const index=fs.readFileSync('wasm/platform/index.js','utf8');
const warning=index.slice(index.indexOf('function warningDialog('),index.indexOf('// Restart the application'));
const notices=index.slice(index.indexOf('function appendWarningNotice('),index.indexOf('// Handle layout elements when displaying the Hosts view'));
const returning=index.slice(index.indexOf('var pendingWarningReturn ='),index.indexOf('// Show a confirmation with the Quit App'));
assert(warning.startsWith('function warningDialog('));assert(returning.includes('function showApps('));
function fixture(){
 const nodes={},handlers={},timers=[],host={};let depth=0,menus=0,focused='';
 const node=id=>{
  if(!nodes[id]){
   const n={style:{},open:false,innerHTML:'',children:[],appendChild(child){this.children.push(child);},showModal(){this.open=true;},close(){this.open=false;},focus(){focused=id;},click(){handlers['#'+id]();}};
   Object.defineProperty(n,'textContent',{get(){return this.innerHTML+this.children.map(child=>child.textContent).join('');},set(text){this.innerHTML=text;this.children=[];}});nodes[id]=n;
  }
  return nodes[id];
 };
 const c={Promise,console:{log(){}},api:host,isInGame:true,isDialogOpen:false,
  document:{hidden:false,body:{classList:{add(){},remove(){}}},createElement:()=>({textContent:''}),getElementById:node,querySelector:selector=>node(selector.slice(1))},
  Navigation:{push(){depth++;},pop(){depth--;},switch(){},change(){}},Views:{WarningDialog:{},Apps:{}},
  ConsoleLibrary:{open(pc){assert.strictEqual(pc,host);assert(!c.isDialogOpen);menus++;return Promise.resolve();}},
  SessionDiagnostics:{finish(){},note(){}},stopVideoPresentationObserver(){},stopAudioScheduler(){},snackbarLogLong(){},
  StreamStartup:{active:()=>false,finish(){},cover(){}},setTimeout(fn){timers.push(fn);},
  $(selector){return {off(){delete handlers[selector];return this;},on(event,fn){handlers[selector]=fn;return this;},css(){return this;},removeClass(){return this;}}}};
 c.window=c;vm.createContext(c);vm.runInContext(notices+'\n'+warning+'\n'+returning+'\n'+fs.readFileSync('wasm/platform/messages.js','utf8'),c);
 return {c,node,host,close:()=>handlers['#closeWarning'](),depth:()=>depth,menus:()=>menus,focused:()=>focused};
}
(async()=>{
 let f=fixture();
 f.c.handleMessage('DialogMsg: First failure');f.c.handleMessage('DialogMsg: Second failure');
 assert.strictEqual(f.depth(),1,'consecutive warnings reuse one view');
 assert.strictEqual(f.node('warningDialogText').innerHTML,'Second failure');
 f.c.handleMessage('streamTerminated: -101');
 assert.strictEqual(f.c.isInGame,false,'termination retires in-game state even behind a warning');
 assert.strictEqual(f.menus(),0,'warning keeps ownership until dismissed');
 assert(f.node('warningDialogText').textContent.includes('Stream ended. Check connection or settings.'),'termination advice stays in the warning');
 f.c.snackbarLogLong('Stream ended. Check connection or settings.');
 assert.strictEqual(f.node('warningDialogText').children.length,1,'repeated advice is not duplicated');
 f.close();await Promise.resolve();
 assert.strictEqual(f.depth(),0);assert.strictEqual(f.menus(),1,'one deferred return after dismissal');
 assert.strictEqual(f.c.pendingWarningReturn,null);
 f=fixture();f.c.warningDialog('Warning','Still connected');f.close();
 assert.strictEqual(f.menus(),0);assert.strictEqual(f.focused(),'wasm_module','connected warnings return focus to video');
 f=fixture();f.c.warningDialog('Warning','Keyboard dismissal');
 let prevented=false;f.node('warningDialog').oncancel({preventDefault(){prevented=true;}});
 assert(prevented);assert.strictEqual(f.depth(),0);assert.strictEqual(f.c.isDialogOpen,false,'Escape uses the same cleanup as Close');
 for(const action of ['hidden','other-host','new-launch']){
  f=fixture();f.c.warningDialog('Warning','Failure');f.c.isInGame=false;await f.c.showApps(f.host);
  if(action==='hidden')f.c.document.hidden=true;
  if(action==='other-host')f.c.api={};
  if(action==='new-launch')f.c.StreamStartup.active=()=>true;
  f.close();assert.strictEqual(f.menus(),0,'obsolete return cannot interrupt '+action);
 }
 console.log('stream_warning_recovery_test: consecutive warnings, deferred native return, video focus and obsolete-return guards PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('wasm/platform/index.js','utf8');
function make() {
 let resolve;const lookup=new Promise(r=>resolve=r),handlers={},nodes={};
 const node=id=>nodes[id]||(nodes[id]={style:{},showModal(){this.open=true;},close(){this.open=false;}});
 const host={currentGame:2,getAppById:()=>lookup},stops=[];
 const c={api:host,Promise,document:{querySelector:s=>node(s.slice(1)),getElementById:node},Navigation:{push(){},pop(){},switch(){}},Views:{QuitAppDialog:{}},
  $:s=>({off(){return this;},on(n,fn){handlers[s]=fn;return this;}}),snackbarLog(){},snackbarLogLong(){},stopGame(h){stops.push(h);return Promise.resolve();}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function quitAppDialog()'),source.indexOf('// Handle layout elements',source.indexOf('function quitAppDialog()'))),c);
 return {c,host,stops,handlers,resolve};
}
(async()=>{
 for(const phase of ['lookup','confirm','valid','missing']) {
  const f=make(),p=f.c.quitAppDialog();await Promise.resolve();
  if(phase==='lookup')f.c.api={currentGame:2};
  f.resolve(phase==='missing'?null:{title:'Fixture Game'});await p;
  if(phase==='confirm')f.c.api={currentGame:2};
  if(f.handlers['#continueQuitApp'])await f.handlers['#continueQuitApp']();
  assert.equal(f.stops.length,phase==='valid'?1:0,phase);
  if(f.stops.length)assert.strictEqual(f.stops[0],f.host);
 }
 console.log('quit_identity_test: delayed lookup, changed host, missing app and original-host confirmation OK');
})().catch(e=>{console.error(e);process.exitCode=1;});

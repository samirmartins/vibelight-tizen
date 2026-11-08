'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const prelude=fs.readFileSync('wasm/app_lifecycle_test.js','utf8').split('\n(async()=>{')[0];
const h={require,console};vm.createContext(h);vm.runInContext(prelude+'\nglobalThis.make=fixture;globalThis.launch=realLauncher;',h);
(async()=>{
 for(const resume of [false,true])for(const audio of ['Stereo','51Surround','71Surround']){
  const f=h.make();h.launch(f,'none',resume);const c=f.c,query=c.$,metadata=[];
  c.$=selector=>{const node=query(selector);if(selector==='#selectAudio')node.data=()=>audio;return node;};c.$.parseXML=query.parseXML;
  c.SessionDiagnostics.configure=value=>metadata.push(value);
  c.startGame(f.host,2);await f.flush();
  assert.equal(metadata.length,1);assert.equal(metadata[0].config.audio,audio,'diagnosis must store the actual audio mode, independent of translated labels');
 }
 for(const resume of [false,true])for(const failure of ['xml','lookup','missing','refresh','native','status']) {
  const f=h.make(),r=h.launch(f,'none',resume),c=f.c;let returned=0,closed=0;
  c.showApps=()=>{returned++;return Promise.resolve();};c.stopAudioScheduler=()=>closed++;
  c.Navigation.switch=()=>{};
  if(failure==='xml')c.$.parseXML=()=>{throw Error('invalid XML');};
  if(failure==='lookup')f.host.getAppById=()=>Promise.reject(Error('lookup'));
  if(failure==='missing')f.host.getAppById=()=>Promise.resolve(null);
  if(failure==='refresh')f.host.refreshServerInfo=()=>Promise.reject(Error('refresh'));
  if(failure==='native')c.sendMessage=()=>Promise.reject(Error('native'));
  if(failure==='status'){const query=c.$;c.$=(x)=>{const q=query(x);q.attr=()=> '500';return q;};c.$.parseXML=query.parseXML;}
  c.startGame(f.host,2);await f.flush();
  assert(!c.isInGame,failure+' releases loading state');assert.equal(closed,1);assert.equal(returned,1);assert(!c.startGame.pending);
 }
 for(const leave of ['settings','hide']) {
  const f=h.make(),r=h.launch(f,'refresh'),c=f.c;
  c.startGame(f.host,2);await f.flush();c.ConsoleLibrary[leave]();r.gate.resolve();await f.flush();
  assert(!r.calls.some(x=>x.kind==='startRequest'),'navigation cancels delayed Play');
 }
 console.log('launch_recovery_test: launch/resume failures, missing app, malformed response, native rejection and navigation cancellation OK');
})().catch(e=>{console.error(e);process.exitCode=1;});

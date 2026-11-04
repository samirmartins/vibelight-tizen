'use strict';
// Production request scope, callback bridge, NvHTTP parser and quit coordinator.
// Synthetic HTTP/clock; native cancellation/deadline wiring is checked below.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),cp=require('child_process'),path=require('path'),os=require('os');
const {setup}=require('./host_availability_test.js');
function fixture(options={}) {
 const f=setup(),c=f.c;let now=0,id=1,info=0;const timers=new Map(),jobs=[];
 c.Date=class extends Date {static now(){return now;}};
 c.setTimeout=(fn,ms)=>{const key=id++;timers.set(key,{fn,at:now+ms});return key;};c.clearTimeout=key=>timers.delete(key);
 c.isInGame=true; // Explicit end-on-PC remains available during a stream.
 c.Module={openUrlScoped(key,url,pin,binary,timeout){
  const job={key,url,pin,timeout,cancelled:false};jobs.push(job);
  if(options.hang&&url.includes('/cancel?'))return;
  let xml;
  if(url.includes('/cancel?'))xml=options.reply||'<root status_code="200"><cancel>1</cancel></root>';
  else {
   const busy=options.busy===true || info++<(options.busy||0);
   xml='<root status_code="200"><uniqueid>fixture-pc</uniqueid><PairStatus>1</PairStatus>'+ 
    '<state>SUNSHINE_SERVER_'+(busy?'BUSY':'FREE')+'</state><currentgame>7</currentgame></root>';
  }
  if(options.infoReply && url.includes('/serverinfo?'))xml=options.infoReply;
  Promise.resolve().then(()=>c.handlePromiseMessage(key,'resolve',xml));
 },cancelMenuRequest(key){const job=jobs.find(x=>x.key===key);assert(job);job.cancelled=true;}};
 vm.runInContext(fs.readFileSync('wasm/platform/messages.js','utf8'),c);
 f.host._baseUrlHttps='https://fixture.invalid:47984';f.host.currentGame=7;
 const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
 async function advance(ms){const target=now+ms;let steps=0;
  for(;;){let next;for(const item of timers)if(item[1].at<=target&&(!next||item[1].at<next[1].at))next=item;
   if(!next)break;assert(++steps<1000);now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}
  now=target;await flush();
 }
 return {c,host:f.host,jobs,timers,flush,advance,info:()=>info};
}
(async()=>{
 let f=fixture();let done=false;const p=f.host.quitApp();assert.strictEqual(f.host.quitApp(),p,'duplicate action shares one request');p.then(()=>done=true);
 await f.flush();assert(done);assert.equal(f.host.currentGame,0);assert.equal(f.jobs.length,2);assert.equal(f.jobs[0].timeout,15000);assert.equal(f.timers.size,0);assert.equal(Object.keys(f.c.callbacks).length,0);
 assert(!Object.keys(f.host).includes('_quitOperation'),'runtime request is not persisted');
 f=fixture({busy:2});done=false;f.host.quitApp().then(()=>done=true);await f.flush();assert(!done,'HTTP acknowledgement is not closure');
 await f.advance(250);assert(!done);await f.advance(250);assert(done);assert.equal(f.jobs.filter(x=>x.url.includes('/cancel?')).length,1);assert.equal(f.timers.size,0);
 for(const reply of ['<root status_code="403"><cancel>1</cancel></root>','<root status_code="200"><cancel>0</cancel></root>','<root status_code="200"></root>','not XML']) {
  f=fixture({reply});const result=f.host.quitApp().then(()=>null,e=>e);await f.flush();assert(await result,'invalid response must fail');assert.equal(f.jobs.length,1);assert.equal(f.timers.size,0);
 }
 for(const infoReply of ['<root status_code="200"><uniqueid>fixture-pc</uniqueid><PairStatus>1</PairStatus></root>', '<root status_code="401"><state>SUNSHINE_SERVER_FREE</state></root>']) {
  f=fixture({infoReply});const result=f.host.quitApp().then(()=>null,e=>e);await f.flush();assert(await result,'incomplete status is not closure');assert.equal(f.timers.size,0);
 }
 f=fixture({hang:true});let error;f.host.quitApp().catch(e=>error=e);await f.flush();await f.advance(14999);assert(!error);await f.advance(1);
 assert(error);assert(f.jobs[0].cancelled);assert.equal(f.timers.size,0);assert.equal(Object.keys(f.c.callbacks).length,0);assert.equal(f.host._quitOperation,null);
 f.c.handlePromiseMessage(f.jobs[0].key,'resolve','<root status_code="200"><cancel>1</cancel></root>');await f.flush();assert.equal(f.jobs.length,1,'late callback is inert');
 f=fixture({busy:true});f.host.quitApp().catch(e=>error=e);await f.flush();await f.advance(15000);assert.equal(f.host._quitOperation,null);assert.equal(f.timers.size,0);const count=f.jobs.length;await f.advance(1000);assert.equal(f.jobs.length,count,'no background poll after deadline');
 for(const options of [{hang:true},{busy:true}]) {
  f=fixture(options);const request=f.host.quitApp();const result=request.then(()=>null,e=>e);await f.flush();request.cancel();await f.flush();assert(await result);assert.equal(f.timers.size,0);assert.equal(Object.keys(f.c.callbacks).length,0);
  const before=f.jobs.length;await f.advance(15000);assert.equal(f.jobs.length,before);
 }
 // Compile the actual scoped native method; the transport is a cancellable fake.
 const source=fs.readFileSync('wasm/http.cpp','utf8');
 const queue=source.slice(source.indexOf('namespace {'),source.indexOf('#include <mkcert.h>'));
 const method=source.slice(source.indexOf('void MoonlightInstance::OpenUrlScoped('),source.indexOf('MessageResult makeCert()'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'host-quit-native-'));
 try {
  const fixture=`
#include <memory>
#include <mutex>
#include <unordered_map>
#include <chrono>
#include <algorithm>
#include <cstring>
#include <string>
#include <vector>
#include <cassert>
#include <cstdlib>
#include <functional>
#define GS_FAILED -1
struct HTTP_DATA {char* memory;size_t size;};
HTTP_DATA* http_create_data(){auto* d=new HTTP_DATA;d->memory=strdup("ok");d->size=2;return d;}
void http_free_data(HTTP_DATA* d){free(d->memory);delete d;}
static int observed=0,calls=0;
int http_request_bounded(const char*,const char*,HTTP_DATA*,int timeout,const int* cancelled){observed=timeout;calls++;assert(!*cancelled);return 0;}
struct Dispatcher {std::vector<std::function<void()>> jobs;template<class F>void post_job(F f,bool){jobs.push_back(f);}void run(){auto ready=std::move(jobs);for(auto& job:ready)job();}};
struct MoonlightInstance {
 Dispatcher m_Dispatcher;std::string status;
 void OpenUrlScoped(int,std::string,std::string,bool,int);
 template<class T>void PostPromiseMessage(int,const char* type,const T&){status=type;}
};
`;
  const test=`
int main(){MoonlightInstance app;
 app.OpenUrlScoped(1,"https://fixture.invalid/cancel?", "pin",false,15000);app.m_Dispatcher.run();assert(observed>14000&&observed<=15000&&app.status=="resolve");
 app.OpenUrlScoped(2,"https://fixture.invalid/cancel?", "pin",false,15000);cancelMenuRequest(2);const int before=calls;app.m_Dispatcher.run();assert(calls==before&&app.status=="reject"&&menuRequests.empty());
 app.OpenUrlScoped(3,"https://fixture.invalid/serverinfo?", "pin",false,4500);app.m_Dispatcher.run();assert(observed>4000&&observed<=4500&&menuRequests.empty());
}
`;
  const file=path.join(dir,'test.cpp'),binary=path.join(dir,'test');fs.writeFileSync(file,fixture+queue+method+test);
  cp.execFileSync('g++',['-std=c++17','-O1','-g','-pthread','-fsanitize=address,undefined','-fno-omit-frame-pointer',file,'-o',binary],{stdio:'inherit'});
  cp.execFileSync(binary,[],{stdio:'inherit',env:{...process.env,ASAN_OPTIONS:'detect_leaks=1',UBSAN_OPTIONS:'halt_on_error=1'}});
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
 const reviewed=require('./session-transition-scope.cjs');
 for(const file of reviewed.files) {
  const current=fs.readFileSync(file,'utf8'),old=cp.execFileSync('git',['cat-file','blob','96584ac:'+file],{encoding:'utf8'});
  assert.equal(reviewed.normalize(file,current),old);
  const unknown=current+'\n// unrelated edit\n';assert.equal(reviewed.normalize(file,unknown),unknown);
  const mutated=current.replace(/15000|launchScope|startGame.pending/, 'unreviewedChange');
  assert.equal(reviewed.normalize(file,mutated),mutated,'unknown changes are not hidden');
 }
 console.log('host_quit_test: 15 s deadline, confirmed closure, refusal, stuck host, cancellation, stale callbacks, no residual timers/callbacks and native scoped wiring PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});

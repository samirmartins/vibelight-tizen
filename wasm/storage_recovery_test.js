'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('wasm/platform/index.js','utf8');
function make(mode) {
 const requests=[],writes=[];let tx;
 const db={transaction(){
  if(mode==='throw')throw Error('unavailable');
  tx={objectStore(){return {get(){const r={};requests.push(r);return r;},put(value,key){writes.push({key,value});return {};}};}};return tx;
 }};
 const c={console:{log(){},error(){},warn(){}},navigator:{},self:{indexedDB:{open(){const r={};requests.push(r);return r;}}},Set,Promise};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('let indexedDB ='),source.indexOf('// Storing data takes')),c);
 c.fixtureDb=db;if(mode!=='open')vm.runInContext('db = fixtureDb',c);
 return {c,requests,writes,tx:()=>tx};
}
for(const mode of ['throw','error','abort','parse','missing','ok','duplicate','open']) {
 const f=make(mode),results=[];
 assert.doesNotThrow(()=>f.c.getData('cert',r=>results.push(r)));
 if(mode==='open'){f.requests[0].onerror({});}
 else if(mode!=='throw') {
  const r=f.requests[0];
  if(mode==='error'||mode==='abort') f.tx()['on'+mode]({});
  else {r.result=mode==='missing'?undefined:mode==='parse'?'{':JSON.stringify({cert:'fixture'});r.onsuccess({});
   if(f.tx().oncomplete)f.tx().oncomplete({});
   if(mode==='duplicate'){r.onsuccess({});f.tx().onerror({});}}
 }
 assert.equal(results.length,1,mode+' completes once');
 assert.equal(results[0].status,mode==='missing'?'missing':['ok','duplicate'].includes(mode)?'ok':'error',mode);
}
{
 const f=make('ok'),r=[];f.c.storeData('cert',{cert:'fixture'},v=>r.push(v));
 assert.equal(r.length,0,'write is not confirmed before transaction commit');
 f.tx().onabort({});f.tx().oncomplete({});assert.equal(r.length,1);assert.equal(r[0].status,'error');
}
console.log('storage_recovery_test: open/transaction/abort/parse/missing/success and single completion OK');

(async()=>{
 const identity=source.slice(source.indexOf('function loadHTTPCerts()'),source.indexOf('function onWindowLoad()'));
 for(const broken of ['cert','uniqueid','hosts','write',null]) {
  const calls=[],saved={cert:{cert:'fixture-cert',privateKey:'fixture-key'},uniqueid:'fixture-id',hosts:{}};
  const original={original:true};
  const c={Promise,hosts:original,console,Set,Object,clearTimeout(){},setTimeout(){return 1;},startupScanTimer:0,
   storageInitializationError(){calls.push('error');},uniqueid(){calls.push('uniqueid');return 'new-id';},
   getData(key,cb){cb(key===broken?{status:'error',code:'read'}:broken==='write'?{status:'missing'}:{status:'ok',value:saved[key]});},
   storeData(key,value,cb){calls.push('write:'+key);cb({status:broken==='write'?'error':'ok'});},
   sendMessage(kind,args){calls.push(kind);return Promise.resolve(kind==='makeCert'?saved.cert:undefined);},
   restoreUiAfterWasmLoad(){calls.push('ready');},startPollingHosts(){},ConsoleLibrary:{ready(){}},addHostToGrid(){},NvHTTP:function(){},snackbarLog(){},startSubnetScanner(){}
  };vm.createContext(c);vm.runInContext(identity,c);
  await c.loadHTTPCerts();
  if(broken){assert(calls.includes('error'));assert(!calls.includes('httpInit'));assert(!calls.includes('ready'));assert.strictEqual(c.hosts,original);
   if(broken!=='write'){assert(!calls.includes('uniqueid'));assert(!calls.includes('makeCert'));assert(!calls.some(x=>x.startsWith('write:')));}
   // A recovered read retries without generating identity or losing existing hosts.
   c.getData=(key,cb)=>cb({status:'ok',value:saved[key]});c.storeData=(key,value,cb)=>cb({status:'ok'});
   await c.loadHTTPCerts();assert(calls.includes('ready'));assert.equal(c.myUniqueid,'fixture-id');
  } else {assert(calls.includes('httpInit'));assert(!calls.includes('makeCert'));assert(!calls.includes('uniqueid'));}
 }
 console.log('storage_recovery_test: saved identity/hosts survive failed initialization, writes and retry OK');
})().catch(e=>{console.error(e);process.exitCode=1;});

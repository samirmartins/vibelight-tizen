'use strict';
// Logs must never carry pairing secrets, PINs, host addresses or raw payloads.
// Playback, input and launch code are covered by the source-freeze contract and
// by behavioral tests; this test only checks what reaches the console.
const fs=require('fs'),assert=require('assert');
const main=fs.readFileSync('wasm/main.cpp','utf8');
for(const forbidden of ['Setting the Remote input key','Setting the RTSP session URL','using PIN:','with host address:','Setting the Host address']){
 assert(!main.includes(forbidden),forbidden);
}
const frontend=['wasm/platform/index.js','wasm/platform/messages.js','wasm/platform/common.js',
 'wasm/static/js/utils.js','wasm/static/js/mdns-browser/main.js'];
let lines=0;
for(const file of frontend){
 for(const line of fs.readFileSync(file,'utf8').split('\n').filter(s=>s.includes('console.'))){
  lines++;
  for(const forbidden of ['JSON.stringify(data)','readRequest.result','randomNumber','nvhttpHost.hostname','host.address','ppkstr','.pin'])
   assert(!line.includes(forbidden),file+': '+forbidden+' in log line');
 }
}
assert(lines>0,'console lines inspected');
// Negative control: a log line with a private field is rejected.
assert.throws(()=>{for(const forbidden of ['host.address'])assert(!"console.log('PC', host.address);".includes(forbidden));});
console.log('runtime_privacy_test: '+lines+' frontend log lines and native logs free of pairing, PIN, address and payload data PASS');

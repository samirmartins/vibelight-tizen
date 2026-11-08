'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const nodes={},calls=[];const host={};
const c={Promise,api:host,document:{getElementById:id=>nodes[id]||(nodes[id]={hidden:true,focus(){}})},
 showApps:h=>{assert.equal(h,host);calls.push('library');},Module:{stopStream(){calls.push('native');}},snackbarLogLong(){}};
vm.createContext(c);vm.runInContext(fs.readFileSync('wasm/platform/stream-startup.js','utf8'),c);
const startup=c.StreamStartup;
(async()=>{
 startup.begin(host,()=>calls.push('cancel'));assert(!nodes.streamStartupPanel.hidden);
 startup.stage('Starting video...');assert.equal(nodes.streamStartupMessage.textContent,'Starting video...');
 startup.cancel();await Promise.resolve();assert.deepStrictEqual(calls,['cancel','library']);
 startup.cancel();assert.equal(calls.length,2,'cancel is idempotent');
 startup.begin(host,()=>calls.push('cancel'));startup.native();startup.cancel();
 assert.deepStrictEqual(calls,['cancel','library','cancel','native'],'native termination owns return');
 startup.stage('stale');assert.notEqual(nodes.streamStartupMessage.textContent,'stale');
 startup.begin(host,()=>calls.push('cancel'));startup.finish();startup.cancel();assert.equal(calls.length,4);
 console.log('stream_startup_test: stages, explicit cancellation, ownership and stale updates PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});

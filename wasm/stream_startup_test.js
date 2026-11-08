'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const nodes={},calls=[],classes=new Set();const host={};
const c={Promise,api:host,document:{body:{classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}},getElementById:id=>nodes[id]||(nodes[id]={hidden:true,style:{},focus(){}})},
 showApps:h=>{assert.equal(h,host);calls.push('library');},Module:{stopStream(){calls.push('native');}},snackbarLogLong(){}};
vm.createContext(c);vm.runInContext(fs.readFileSync('wasm/platform/stream-startup.js','utf8'),c);
const startup=c.StreamStartup;
(async()=>{
 c.document.getElementById('loadingSpinner').style.display='inline-block';
 c.document.getElementById('loadingSpinnerMessage').textContent='Old progress';
 startup.begin(host,()=>calls.push('cancel'));assert(!nodes.streamStartupPanel.hidden);
 assert.equal(nodes.loadingSpinner.style.display,'none','startup owns progress instead of the old spinner');
 assert.equal(nodes.loadingSpinnerMessage.textContent,'');assert(classes.has('stream-starting'));
 startup.cover(true);assert(nodes.streamStartupPanel.hidden,'confirmation or warning owns the screen');
 startup.cover(false);assert(!nodes.streamStartupPanel.hidden,'startup returns after the dialog');
 startup.stage('Starting video...');assert.equal(nodes.streamStartupMessage.textContent,'Starting video...');
 startup.cancel();await Promise.resolve();assert.deepStrictEqual(calls,['cancel','library']);
 assert(nodes.streamStartupPanel.hidden);assert(!classes.has('stream-starting'));
 startup.cover(false);assert(nodes.streamStartupPanel.hidden,'a late dialog close cannot revive startup');
 startup.cancel();assert.equal(calls.length,2,'cancel is idempotent');
 startup.begin(host,()=>calls.push('cancel'));startup.native();startup.cancel();
 assert.deepStrictEqual(calls,['cancel','library','cancel','native'],'native termination owns return');
 startup.stage('stale');assert.notEqual(nodes.streamStartupMessage.textContent,'stale');
 startup.begin(host,()=>calls.push('cancel'));startup.finish();startup.cancel();assert.equal(calls.length,4);
 console.log('stream_startup_test: single progress owner, dialog priority, stages, cancellation and stale updates PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});

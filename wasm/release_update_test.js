'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('wasm/platform/release-update.js', 'utf8');
function fixture(installed='3.4.15') {
  let saved = {}, requests = [], dialogs = [], listener = null, visible = true, shown = false;
  const button = { addEventListener: (_, f) => listener = f, removeEventListener: (_, f) => { if (listener === f) listener = null; }, click() { shown = false; if (listener) listener(); } };
  const dialog = { style:{top:'',bottom:'',transform:''}, get open() { return shown; } };
  class XHR {
    constructor() { requests.push(this); }
    open(method,url,async) { assert.strictEqual(method,'GET'); assert(url.startsWith('https://api.github.com/')); assert.strictEqual(async,true); }
    send() {}
    abort() { this.aborted = true; }
    reply(data,status=200) { this.status=status; this.responseText=typeof data==='string'?data:JSON.stringify(data); if (this.onload) this.onload(); }
  }
  const c = { XMLHttpRequest:XHR, appInfo:{version:installed}, document:{getElementById:id=>id==='closeWarning'?button:dialog},
    localStorage:{getItem:k=>saved[k]||null,setItem:(k,v)=>{saved[k]=v;}},
    warningDialog:(title,text)=>{dialogs.push({title,text});shown=true;} };
  vm.runInNewContext(source,c);
  return { check:()=>c.ReleaseUpdate.check(()=>visible), cancel:()=>c.ReleaseUpdate.cancel(), requests, dialogs, button,
    setVisible:v=>visible=v, saved, setStoreBroken:()=>{c.localStorage.getItem=()=>{throw Error()};c.localStorage.setItem=()=>{throw Error()};} };
}
const release = (tag) => ({tag_name:tag,draft:false,prerelease:false});
{
  const f=fixture(); f.check(); assert.equal(f.requests[0].timeout,5000); f.requests[0].reply(release('v3.4.16'));
  assert.equal(f.dialogs.length,1); assert(f.dialogs[0].text.includes('3.4.16')); f.button.click();
  f.check(); f.requests[1].reply(release('v3.4.16')); assert.equal(f.dialogs.length,1);
  f.check(); f.requests[2].reply(release('v3.4.17')); assert.equal(f.dialogs.length,2);
}
for (const item of [release('v3.4.15'),release('v3.4.2'),release('v3.4.16-rc1'),release('v3.4.16<script>'),{...release('v3.4.16'),draft:true},{...release('v3.4.16'),prerelease:true},'not json']) {
  const f=fixture(); f.check(); f.requests[0].reply(item); assert.equal(f.dialogs.length,0);
}
{
  const f=fixture(); f.check(); const pending=f.requests[0], late=pending.onload; f.cancel();
  assert(pending.aborted); pending.status=200; pending.responseText=JSON.stringify(release('v3.4.16')); late(); assert.equal(f.dialogs.length,0);
  f.check(); f.setVisible(false); f.requests[1].reply(release('v3.4.16')); assert.equal(f.dialogs.length,0);
}
{
  const f=fixture(); f.setStoreBroken(); f.check(); f.requests[0].reply(release('v3.4.16')); f.button.click();
  f.check(); f.requests[1].reply(release('v3.4.16')); assert.equal(f.dialogs.length,1);
}
{
  const f=fixture(); f.check(); f.requests[0].reply(release('v3.4.16')); f.cancel();
  assert.equal(f.dialogs.length,1); f.check(); f.requests[1].reply(release('v3.4.16')); assert.equal(f.dialogs.length,1);
}
for (const [installed,latest,expected] of [
  ['3.4.9','v3.4.10',1],['3.9.99','v3.10.0',1],['3.99.99','v4.0.0',1],
  ['3.10.0','v3.9.99',0],['3.4.15','v3.4.14',0],['3.4.15','v03.4.16',0]]) {
  const f=fixture(installed);f.check();f.requests[0].reply(release(latest));assert.equal(f.dialogs.length,expected);
}
for(const status of [403,404,429,500]) {
  const f=fixture();f.check();f.requests[0].reply(release('v3.4.16'),status);assert.equal(f.dialogs.length,0);
}
for(const failure of ['onerror','ontimeout']) {
  const f=fixture();f.check();f.requests[0][failure]();assert.equal(f.dialogs.length,0);
}
{
  const f=fixture();f.check();const req=f.requests[0];req.onprogress({loaded:262145});assert(req.aborted);assert.equal(f.dialogs.length,0);
}
console.log('release_update_test: version, persistence, malformed responses, cancellation and unavailable storage PASS');

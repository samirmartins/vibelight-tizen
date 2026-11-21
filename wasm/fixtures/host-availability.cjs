'use strict';
// Production NvHTTP and console library with a synthetic host transport whose
// state ('on', 'off', 'denied', ...) the test switches between menu visits.
const assert=require('assert');
const {fixture}=require('./console-library.cjs');
function xmlQuery(xml,tag='root') {
  const appMatches=[...xml.matchAll(/<App>([\s\S]*?)<\/App>/g)];
  const root={getElementsByTagName(name){return name==='App'?appMatches.map(m=>({getElementsByTagName(n){const v=m[1].match(new RegExp('<'+n+'>([\\s\\S]*?)</'+n+'>'));return v?[{textContent:v[1]}]:[];}})):[];}};
  return {length:/^<root\b[^>]*>[\s\S]*<\/root>$/.test(xml)?1:0,0:root,
    find(n){return xmlQuery(xml,n);},attr(){const m=xml.match(/status_code="(\d+)"/);return m?m[1]:undefined;},
    text(){const m=xml.match(new RegExp('<'+tag+'>([^<]*)</'+tag+'>'));return m?m[1]:'';},each(){}};
}
const list='<root status_code="200"><App><ID>1</ID><AppTitle>Game 001</AppTitle></App></root>';
const empty='<root status_code="200"></root>',denied='<root status_code="401"></root>';
async function retry(f) {
  assert.strictEqual(f.timers.size,0,'no periodic retry remains armed');
  await f.open();
}
function setup() {
  const f=fixture(1),c=f.c,h=f.host,raw=new c.NvHTTP('fixture.invalid','fixture');
  delete h.connect;delete h.getAppListWithCacheFlush;
  Object.setPrototypeOf(h,c.NvHTTP.prototype);
  Object.assign(h,{address:'fixture.invalid',localAddress:'',userEnteredAddress:'',externalIP:'',hostname:'fixture',
    httpsPort:47984,httpPort:47989,ppkstr:'synthetic pin',clientUid:'fixture',paired:true,online:false,_authenticatedOnline:false});
  const domQuery=c.$;c.$=xml=>typeof xml==='string'&&xml.startsWith('<')?xmlQuery(xml):domQuery(xml);c.$.parseXML=xml=>xml;
  f.requests=[];f.state='off';
  c.sendMessage=(name,args)=>{
    assert.strictEqual(name,'openUrlScoped');assert(args[0].startsWith('https://'));assert.strictEqual(args[1],h.ppkstr);
    f.requests.push(args);
    if(args[0].includes('/serverinfo?')) {
      if(f.state==='off')return Promise.reject(Error('unreachable'));
      if(f.state==='denied')return Promise.resolve(denied);
      return Promise.resolve('<root status_code="200"><uniqueid>fixture-pc</uniqueid><hostname>fixture</hostname><PairStatus>1</PairStatus></root>');
    }
    assert(args[0].includes('/applist?'),'no unrelated network operation');
    if(f.state==='off')return Promise.reject(Error('unreachable'));
    if(f.state==='denied')return Promise.resolve(denied);
    if(f.state==='empty')return Promise.resolve(empty);
    if(f.state==='malformed')return Promise.resolve('<root status_code="200"><App></App></root>');
    return Promise.resolve(list);
  };
  return f;
}
module.exports={setup,retry};

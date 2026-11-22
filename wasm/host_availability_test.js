'use strict';
// Production NvHTTP + library, synthetic transport and explicit menu visits.
// Browser coverage separately exercises the XML parser with actual DOMParser.
const assert=require('assert');
const {setup,retry}=require('./fixtures/host-availability.cjs');
(async()=>{
  const f=setup();await f.open();
  for(let i=0;i<12;i++){await retry(f);assert.strictEqual(f.host.online,false);assert.strictEqual(f.host.paired,true);}
  f.state='denied';for(let i=0;i<3;i++){await retry(f);assert(!f.host.online);assert.strictEqual(f.host.httpsPort,47984);}
  f.state='on';await retry(f);
  assert.match(f.node('libraryStatus').textContent,/PC online/);assert(f.host.online&&f.host._authenticatedOnline&&f.host.paired);
  assert.strictEqual(f.host.httpsPort,47984,'boot metadata cannot erase port');
  assert.strictEqual(f.node('libraryPlay').textContent,'Play');assert.strictEqual(f.timers.size,0);
  assert(f.requests[0][0].includes('/serverinfo?'),'startup serverinfo is the connection prerequisite');
  assert(f.requests.filter(a=>a[0].includes('/serverinfo?')).every(a=>a[3]===24000));
  // The same running client survives another off/on cycle and accepts zero games.
  f.state='off';await f.c.ConsoleLibrary.open(f.host);await f.flush();assert(!f.host.online);
  f.state='malformed';await retry(f);assert(f.host.online);assert.match(f.node('libraryStatus').textContent,/Games unavailable/);assert.strictEqual(f.host._memCachedApplist.length,1,'bad response cannot replace last good cache');
  f.state='empty';await retry(f);assert(f.host.online&&f.host._authenticatedOnline);
  assert.match(f.node('libraryStatus').textContent,/0 games/);assert.strictEqual(f.host._memCachedApplist.length,0);
  f.suspend();assert.strictEqual(f.timers.size,0);assert.strictEqual(f.node('game-grid').children.length,0);
  // A cached list alone is never evidence; a new native request is mandatory.
  const g=setup();g.host._memCachedApplist=[{id:1,title:'Cached only'}];await g.open();assert(g.requests.length>0);assert(!g.host.online);g.suspend();
  // Real credential/HTTP failures remain negative; all startup candidates are tried.
  const r=setup();r.host.localAddress='lan.fixture.invalid';r.host.userEnteredAddress='manual.fixture.invalid';r.host.externalIP='wan.fixture.invalid';
  await r.open();const first=r.requests.slice();assert.strictEqual(first.length,5);
  assert(first.every(a=>a[0].includes('/serverinfo?')),'offline never fetches the app list');
  await retry(r);assert.strictEqual(r.requests.length,10);assert.deepStrictEqual(r.requests.slice(5).map(a=>a[0].split('?')[0]),first.map(a=>a[0].split('?')[0]));
  assert(r.requests.every(a=>a[0].startsWith('https://')));r.suspend();
  console.log('host_availability_test: serverinfo-first connection, 12 explicit offline visits, auth delay, second power cycle, empty/bad lists, full fallback scan and no periodic polling OK');
})().catch(error=>{console.error(error);process.exitCode=1;});

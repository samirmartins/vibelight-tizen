'use strict';
// Exercise the production menu with DOM ownership and cancellable requests.
const assert = require('assert');
const {fixture} = require('./fixtures/console-library.cjs');
(async()=>{
  const f = fixture(); await f.open();
  let before = f.calls.length;
  const cards = f.node('game-grid').children.slice(), images = cards.map(n=>n.querySelector('img'));
  await f.open();
  assert.strictEqual(f.calls.length,before,'warm library/metadata refresh does not read/fetch covers');
  assert.deepStrictEqual(f.node('game-grid').children,cards,'unchanged grid preserves exact nodes/order');
  assert.deepStrictEqual(cards.map(n=>n.querySelector('img')),images,'decoded image elements are reused');
  f.suspend(); assert.strictEqual(f.node('game-grid').children.length,0,'no image elements retained in streaming grid');
  assert.strictEqual(f.timers.size,0,'no cache timer or background cover work during gameplay');
  await f.open(); assert.strictEqual(f.calls.length,before,'return from stream reuses cached URLs');
  // Explicit library refresh reuses decoded covers without restarting the app.
  const old = f.card(1).querySelector('img').src; f.revision();
  f.node('libraryRefresh').click(); await f.flush();
  assert.strictEqual(f.io.reloads,0);
  assert.strictEqual(f.calls.length,before);
  assert.strictEqual(f.card(1).querySelector('img').src,old,'metadata refresh does not renew covers');
  before=f.calls.length;
  f.c.ConsoleLibrary.favorite(); f.node('libraryFavorites').click(); await f.flush();
  f.node('libraryAll').click(); await f.flush();
  assert.strictEqual(f.calls.length,before,'filter/favorite changes reuse loaded images');
  f.host.online=false; await f.open(); assert.strictEqual(f.calls.length,before,'offline library reuses warm covers without IO');
  f.host.online=true; await f.open();
  // Removed and renamed apps cannot inherit stale memory entries.
  f.apps[1].title='Renamed fixture'; await f.open();
  assert(f.calls.slice(before).every(call=>call.appId===2));
  f.apps.splice(2,1); await f.open(); before=f.calls.length;
  f.apps.push({id:3,title:'Game 003'}); await f.open();
  assert(f.calls.length>before && f.calls.slice(before).every(call=>call.appId===3));
  // The existing explicit disk-cache clear must invalidate URL/card reuse too.
  await f.c.NvHTTP.prototype.clearBoxArt.call(f.host); assert.strictEqual(f.io.deletes,1);
  before=f.calls.length; await f.open(); assert(f.calls.length>=before+f.apps.length);
  // Changing PCs must not leak covers, even when app IDs/titles are identical.
  const oldHost=f.host, other={...oldHost,serverUid:'other-fixture',hostname:'Other fixture',getBoxArt(appId){return Promise.resolve('data:image/png;base64,other-'+appId);}};
  f.c.hosts[other.serverUid]=other; await f.c.ConsoleLibrary.open(other); await f.flush();
  assert(f.card(1).querySelector('img').src.includes('other-1'));
  f.suspend();
  // Count and string-byte budgets independently; oversized art still displays.
  const many=fixture(70); await many.open(); before=many.calls.length; many.suspend(); await many.open();
  assert(many.calls.length>before,'more than 64 entries must be evicted');
  assert(many.calls.length-before<=10,'all retained cache hits are seeded before misses can evict them');
  many.suspend();
  const big=fixture(4,id=>'https://fixture.invalid/'+String(id).repeat(900000)); await big.open();
  before=big.calls.length; big.suspend(); await big.open();
  assert(big.calls.length>before,'string-byte budget evicts covers independently of count'); big.suspend();
  const huge=fixture(1,()=> 'https://fixture.invalid/'+'x'.repeat(2200000)); await huge.open();
  assert(huge.card(1).querySelector('img').src.length>2200000,'oversized cover is still displayed');
  before=huge.calls.length; huge.suspend(); await huge.open(); assert(huge.calls.length>before,'oversized cover is not retained'); huge.suspend();
  // Late/cancelled work must not refill memory or mutate the streaming DOM.
  const late=fixture(3); late.host.delay=[];
  const opening=late.c.ConsoleLibrary.open(late.host); await late.flush();
  late.suspend(); const pending=late.host.delay.splice(0); before=late.calls.length;
  pending.forEach(resolve=>resolve('data:image/png;base64,late')); await opening; await late.flush();
  assert.strictEqual(late.node('game-grid').children.length,0);
  assert.strictEqual(late.calls.length,before,'late completions cannot start more requests');
  assert.strictEqual(late.timers.size,0);
  late.host.delay=null; await late.open(); assert(late.calls.length>=before+late.apps.length,'cancelled replies never enter cache'); late.suspend();
  const clearing=fixture(4); await clearing.open();
  clearing.host.online=false;
  clearing.host.delay=[]; clearing.c.ConsoleLibrary.invalidateCovers(clearing.host);
  const reopening=clearing.c.ConsoleLibrary.open(clearing.host); await clearing.flush();
  const displayed=clearing.card(1).querySelector('img').src;
  assert.strictEqual(clearing.host.delay.length,2,'only two concurrent renewal requests');
  await clearing.c.NvHTTP.prototype.clearBoxArt.call(clearing.host);
  before=clearing.calls.length;
  clearing.host.delay.splice(0).forEach(resolve=>resolve('data:image/png;base64,stale-clear'));
  await reopening; await clearing.flush();
  assert.strictEqual(clearing.calls.length,before,'cleared scope cannot continue its queue');
  assert.strictEqual(clearing.card(1).querySelector('img').src,displayed,'cleared late replies cannot overwrite a displayed cover');
  clearing.host.delay=null; clearing.suspend(); await clearing.open();
  assert(clearing.calls.length>=before+clearing.apps.length,'clear remains effective after old replies arrive'); clearing.suspend();
  console.log('library_cover_cache_test: warm return, node reuse, reload cancellation, filters, offline, host/app invalidation, bounded LRU, and oversized art OK');
})().catch(error=>{console.error(error);process.exitCode=1;});

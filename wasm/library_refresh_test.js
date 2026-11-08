'use strict';
const assert=require('assert');
const {fixture}=require('./library_cover_cache_test.js');
(async()=>{
 const f=fixture();await f.open();let lists=0,reloads=0;
 f.c.location={reload(){reloads++;}};
 const original=f.host.getAppListWithCacheFlush;
 f.host.getAppListWithCacheFlush=function(){lists++;return original.apply(this,arguments);};
 const before=f.calls.length;
 f.node('libraryRefresh').onclick();await f.flush();
 assert.equal(reloads,0,'refresh must not restart the app');
 assert.equal(lists,1,'refresh queries the current host once');
 assert.equal(f.calls.length,before,'unchanged artwork is reused');
 f.suspend();console.log('library_refresh_test: app list refresh, no restart and no cover reload PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});

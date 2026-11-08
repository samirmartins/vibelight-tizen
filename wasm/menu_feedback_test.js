'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('wasm/platform/index.js','utf8');
const notices=[];let fail=true,transaction;
const db={transaction(){if(fail)throw Error('quota');return transaction={objectStore(){return {put(){return {};}};}};}};
const c={Set,Promise,console:{log(){},error(){}},snackbarLogLong:text=>notices.push(text),fixtureDb:db};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let indexedDB ='),source.indexOf('// Storing data takes'))+'\ndb=fixtureDb;',c);
c.storeData('bitrate',65,null);assert.equal(notices.length,1,'failed preference writes notify the user');
c.storeData('bitrate',70,null);c.storeData('videoCodec','HEVC',null);assert.equal(notices.length,1,'one notice per unresolved failure episode');
fail=false;c.storeData('bitrate',65,null);transaction.oncomplete();c.storeData('videoCodec','HEVC',null);transaction.oncomplete();
fail=true;c.storeData('bitrate',80,null);assert.equal(notices.length,2,'a recovered write permits a later error notice');
let owned;c.storeData('cert',{},result=>owned=result);assert.equal(owned.status,'error');assert.equal(notices.length,2,'identity callers keep their explicit error handling');
const info=source.slice(source.indexOf('function loadSystemInfo()'),source.indexOf('function getAppVariant()'));
const build=source.slice(source.indexOf('function getBuildVersion('),source.indexOf('// Updates the host status indicator'));
assert(info.startsWith('function loadSystemInfo()'));
for(const commit of ['abcdef1234567890','__BUILD_COMMIT__','not-a-commit']){
 const node={};const context={console:{log(){},error(){}},document:{getElementById:()=>node},appInfo:{version:'4.0.3',name:'VibeLight'},getBuildVersion:v=>v,getAppVariant:()=> 'Normal',BUILD_COMMIT:commit,platformVer:'9',modelName:'Fixture TV',modelSeries:'Fixture',modelGroup:'Fixture',is4kPanel:true,isHdrCapable:false};
 context.BUILD_TYPE='development';vm.createContext(context);vm.runInContext(build+'\n'+info,context);context.loadSystemInfo();
 assert(node.innerText.includes('Build:'),'production information always identifies the build');
 if(commit==='abcdef1234567890')assert(node.innerText.includes(commit.slice(0,12)));
 else{assert(!node.innerText.includes(commit));assert(node.innerText.includes('Unavailable'));}
}
console.log('menu_feedback_test: preference failure episodes, callback ownership and valid/missing build metadata PASS');

'use strict';
const assert=require('assert'),fs=require('fs'),cp=require('child_process');
const scope=require('./review-corrections-scope.cjs');
for(const file of scope.files){
 const current=require('./experience-scope.cjs').normalize(file,fs.readFileSync(file,'utf8'));
 assert(scope.matches(file,current),file);
 const base=cp.execFileSync('git',['cat-file','blob','6fe39d2:'+file],{encoding:'utf8'});
 assert.equal(scope.normalize(file,current),base);
 for(const mutation of [current+'\n// unrelated edit\n',current.replace(/return|if/,'unreviewedChange')]){
  assert(!scope.matches(file,mutation),file+' rejects unknown edits');
  assert.equal(scope.normalize(file,mutation),mutation);
 }
}
console.log('review_scope_test: reviewed corrections only, historical baseline and negative controls OK');

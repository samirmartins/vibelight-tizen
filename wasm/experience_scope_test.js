'use strict';
const assert=require('assert'),fs=require('fs'),cp=require('child_process');
const scope=require('./experience-scope.cjs');
for(const file of scope.files){
 const source=fs.readFileSync(file,'utf8');assert(scope.matches(file,source),file+' reviewed bytes');
 assert.equal(scope.normalize(file,source),cp.execFileSync('git',['cat-file','blob','b46c204:'+file],{encoding:'utf8'}));
 for(const mutation of [source+'\n// unexpected\n',source.replace(/[A-Za-z]/,'X')]){
  assert(!scope.matches(file,mutation));assert.equal(scope.normalize(file,mutation),mutation);
 }
}
for(const file of Object.keys(scope.added)){const source=fs.readFileSync(file);assert(scope.matchesAdded(file,source),file);assert(!scope.matchesAdded(file,Buffer.concat([source,Buffer.from('unexpected')])));}
// Native changes are restricted to the opt-in diagnostics payload formatter.
function withoutPayload(s){
 const a=s.indexOf('void MoonlightInstance::PublishDiagnostics('),b=s.indexOf('void MoonlightInstance::TogglePerformanceStats()',a);
 assert(a>0&&b>a);return s.slice(0,a)+'[diagnostic payload]'+s.slice(b);
}
const base=cp.execFileSync('git',['cat-file','blob','b46c204:wasm/wasmplayer.cpp'],{encoding:'utf8'});
assert.equal(withoutPayload(fs.readFileSync('wasm/wasmplayer.cpp','utf8')),withoutPayload(base),'native video/PTS/decoder/pacing healthy paths unchanged');
for(const file of ['wasm/main.cpp','wasm/input.cpp','wasm/gamepad.cpp','wasm/auddec.cpp','wasm/audio_ring.hpp','wasm/platform/audio.js','wasm/platform/audio-worklet.js'])
 assert.equal(fs.readFileSync(file,'utf8'),cp.execFileSync('git',['cat-file','blob','b46c204:'+file],{encoding:'utf8'}),file+' playback unchanged');
console.log('experience_scope_test: exact approved files, negative controls and unchanged native playback/audio/input PASS');

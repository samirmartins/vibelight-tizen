'use strict';
// Only the reviewed identity/reannouncement and system-gesture integration is
// reversible here. Each approved state maps to the same pre-identity baseline.
// Behavioral tests exercise the real sources and unchanged healthy input trace.
const crypto=require('crypto'),cp=require('child_process');
const hashes={
 'wasm/gamepad.cpp':[
   '7f422972c670873e038b7849449d5a9bcac47746cc52bcb3ace4523659a7c2e1',
   'c203b4051f2785b11dd98fccb3181994d44df87a6f1f9297884cc63e7fa89f3c'
 ],
 'wasm/platform/gamepad.js':'c07128fd51010e07797679663c17cc6536d2cbffe06fab40e6955ada1eef091a'
};
function matches(file,text){
 const approved=hashes[file];
 if(!approved)return false;
 const hash=crypto.createHash('sha256').update(text).digest('hex');
 return Array.isArray(approved)?approved.includes(hash):hash===approved;
}
function normalize(file,text){
 text=require('./shared-paths-scope.cjs').normalize(file,text);
 if(!matches(file,text))return text;
 return cp.execFileSync('git',['show','0b77114:'+file],{encoding:'utf8'});
}
module.exports={normalize,files:Object.keys(hashes)};

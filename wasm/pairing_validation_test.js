'use strict';
const cp=require('child_process'),fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pairing-validation-'));
try {
 const bin=path.join(dir,'test');
 let source='wasm/pairing_validation_test.c';
 const baseline=process.argv.includes('--baseline-handshake');
 if(baseline) {
  const old=path.join(dir,'pairing.c');
  fs.writeFileSync(old,cp.execFileSync('git',['cat-file','blob','6fe39d2:libgamestream/pairing.c']));
  source=path.join(dir,'test.c');
  fs.writeFileSync(source,fs.readFileSync('wasm/pairing_validation_test.c','utf8').replace('../libgamestream/pairing.c',old));
 }
 cp.execFileSync('gcc',['-std=gnu11','-Wno-deprecated-declarations','-Wno-error=incompatible-pointer-types','-Ilibgamestream','-O1','-g','-fsanitize='+ (process.env.ML_NATIVE_SANITIZERS || 'address,undefined'),'-fno-omit-frame-pointer',source,'-lcrypto','-o',bin],{stdio:'inherit'});
 cp.execFileSync(bin,baseline?['handshake']:[],{stdio:'inherit',env:{...process.env,ASAN_OPTIONS:'detect_leaks=1',UBSAN_OPTIONS:'halt_on_error=1'}});
 console.log('pairing_validation_test: completed');
} finally {fs.rmSync(dir,{recursive:true,force:true});}

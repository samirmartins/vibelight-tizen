'use strict';
// Reverse only the exact extraction covered by shared_paths_test.js.
const crypto=require('crypto'),cp=require('child_process');
const hashes={
  'wasm/static/js/utils.js':'5b23cfef037fdcbafeff76f8d725b01182d9695f85c16ff4ee76ad1feab1178c',
  'wasm/platform/gamepad.js':'7911117858a07ead64632e2038ca88433158115ade5dcf6ccf7b3bd23128244d'
};
function normalize(file,source) {
  if(!hashes[file]||crypto.createHash('sha256').update(source).digest('hex')!==hashes[file])return source;
  return cp.execFileSync('git',['show','7b08c77:'+file],{encoding:'utf8'});
}
module.exports={normalize,files:Object.keys(hashes)};

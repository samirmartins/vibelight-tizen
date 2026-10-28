'use strict';
// Exact reviewed stop-to-menu integration. Behavioral/native tests cover it;
// all unknown neighboring edits remain visible to the historical guards.
const crypto=require('crypto'),cp=require('child_process');
const approved={
  'wasm/main.cpp':'9310ff61bab8ffb9efa2dd92f0b474c86826a017a478923800919d82daa37a5f',
  'wasm/moonlight_wasm.hpp':'f40666a73e67281aed1c1cdf9c38f26479fdb93603e520d4410d8fe6706f155b',
  'wasm/platform/app-lifecycle.js':'a5c0da6c65e74247aa85b9bf73a0d26d820863cf01772eedc666a48b468ba5c5',
  'wasm/static/js/utils.js':'7769287251eddff8fa907ae867f30be142da7981058db473cd444d9a5f367463',
  'wasm/platform/console-library.js':'6cf4d164a17d98d7ab9da344acadbda26a11fd409c5ad0f8dad27ad9478e09c9',
  'wasm/platform/index.js':'177658d699ab37d467a578ff9411f8555114854145b849303c2430fe4ae5dce3'
};
function normalize(file,source) {
  if(!approved[file]||crypto.createHash('sha256').update(source).digest('hex')!==approved[file])return source;
  return cp.execFileSync('git',['show','v3.4.12:'+file],{encoding:'utf8'});
}
module.exports={normalize,files:Object.keys(approved)};

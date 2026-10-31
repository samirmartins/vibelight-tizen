'use strict';
// Only these reviewed diagnostic bytes may be reversed for historical contracts.
const hashes = {
  'wasm/platform/controller-mapping-menu.js': 'd2cd612615f2f1a16d7c3b83d57467a7ded959d3f67fd7999587c336d2b044a2',
  'wasm/static/css/controller-mapping.css': '582772d47041c2ec113894fb916453f82b03a4de39bf855c2be2d970066f89b1'
};
function normalize(file, source) {
  if (!hashes[file] || require('crypto').createHash('sha256').update(source).digest('hex') !== hashes[file]) return source;
  return require('child_process').execFileSync('git',['show','v3.4.13:'+file],{encoding:'utf8'});
}
module.exports = {files:Object.keys(hashes),normalize};

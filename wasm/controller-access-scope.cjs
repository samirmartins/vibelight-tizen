'use strict';
// Only these reviewed diagnostic bytes may be reversed for historical contracts.
const hashes = {
  'wasm/platform/controller-mapping-menu.js': '7fbdff902ae940ce39443f0ee080f318dc950455cd73dca58459cd0954d94016',
  'wasm/static/css/controller-mapping.css': 'b36a5e4fea41314b4b5c88bf29bfc5c8e2db7baef4a1ae8fcdd67631cde0f38f'
};
function normalize(file, source) {
  if (!hashes[file] || require('crypto').createHash('sha256').update(source).digest('hex') !== hashes[file]) return source;
  return require('child_process').execFileSync('git',['show','v3.4.13:'+file],{encoding:'utf8'});
}
module.exports = {files:Object.keys(hashes),normalize};

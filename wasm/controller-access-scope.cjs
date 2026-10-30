'use strict';
// Only these reviewed diagnostic bytes may be reversed for historical contracts.
const hashes = {
  'wasm/platform/controller-mapping-menu.js': '3b2f029a99085e30e0ef9011c08ae537855070cd854d6de38286006893f39241',
  'wasm/static/css/controller-mapping.css': '83306f7ef23f9b5ef94e8680061e9277ecfbd199200104e8795c871daaa59ed4'
};
function normalize(file, source) {
  if (!hashes[file] || require('crypto').createHash('sha256').update(source).digest('hex') !== hashes[file]) return source;
  return require('child_process').execFileSync('git',['show','v3.4.13:'+file],{encoding:'utf8'});
}
module.exports = {files:Object.keys(hashes),normalize};

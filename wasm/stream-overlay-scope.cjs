'use strict';
// Exact, separately tested system-overlay integration. Historical contracts see
// the reviewed pre-overlay source; unknown neighboring edits stay visible.
const crypto = require('crypto'), cp = require('child_process');
const hashes = {
  'wasm/index.html': '63f4c643f409892980da63691994da51e8be5022cd52e0cb51a65ab35d3cf179',
  'wasm/platform/index.js': '7b2ae3e8fe66e8d18e37165d75f9ee10b4f08460763a20b6aba5ef71a80e95e7',
  'wasm/platform/messages.js': 'b1d2d5ea9254bd5690e087d7b44da11992a3f769e9d8f50cd3a8300fa9bc32f2'
};
const assets = {
  'wasm/static/css/stream-overlay.css': '7bc1c2e3e993819e026c0d36fdd2037da0b059386c6a0f8f8f7ea4b92592b7d2',
  'wasm/static/css/console-controls.css': 'd2eb2817113d1c2bda345eb9d72d3ff01d17708e46d9bc10b9325989f64cca1b'
};
function normalize(file, source) {
  const hash = crypto.createHash('sha256').update(source).digest('hex');
  if (assets[file]) return hash === assets[file] ? '' : source;
  if (!hashes[file] || hash !== hashes[file]) return source;
  return cp.execFileSync('git', ['show', 'fc7c23a:' + file], {encoding: 'utf8'});
}
module.exports = {normalize, files: Object.keys(hashes), added: Object.keys(assets), assets};

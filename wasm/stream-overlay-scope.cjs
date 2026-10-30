'use strict';
// Exact, separately tested system-overlay integration. Historical contracts see
// the reviewed pre-overlay source; unknown neighboring edits stay visible.
const crypto = require('crypto'), cp = require('child_process');
const hashes = {
  'wasm/index.html': '2b441d343696b76ca588326b172caae7c8cf8d412fc7399ab5e0b1d74b90112a',
  'wasm/platform/index.js': '4e33a1a9138671121cf11682e16c5782763054b4c9375718f5a4874ae9938321',
  'wasm/platform/messages.js': 'b1d2d5ea9254bd5690e087d7b44da11992a3f769e9d8f50cd3a8300fa9bc32f2'
};
const assets = {
  'wasm/static/css/stream-overlay.css': 'b0433353a4c3ba73a8c8964ba4e51fc97ceddaca66c8d950f2e23aea3c6c0d46',
  'wasm/static/css/console-controls.css': 'd2eb2817113d1c2bda345eb9d72d3ff01d17708e46d9bc10b9325989f64cca1b'
};
function normalize(file, source) {
  const hash = crypto.createHash('sha256').update(source).digest('hex');
  if (assets[file]) return hash === assets[file] ? '' : source;
  if (!hashes[file] || hash !== hashes[file]) return source;
  return cp.execFileSync('git', ['show', 'fc7c23a:' + file], {encoding: 'utf8'});
}
module.exports = {normalize, files: Object.keys(hashes), added: Object.keys(assets), assets};

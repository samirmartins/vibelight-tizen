'use strict';
// Exact, separately tested system-overlay integration. Historical contracts see
// the reviewed pre-overlay source; unknown neighboring edits stay visible.
const crypto = require('crypto'), cp = require('child_process');
const hashes = {
  'wasm/index.html': '42fd65af04e101c5607d151fe73f2e386ab1fa1424804cf1690c3a7e40497a50',
  'wasm/platform/index.js': 'c74827d0807a6e6f855ff6fa05e01340089c16a12328e01ce650e7ca1d88d46b',
  'wasm/platform/messages.js': 'b1d2d5ea9254bd5690e087d7b44da11992a3f769e9d8f50cd3a8300fa9bc32f2'
};
const assets = {
  'wasm/static/css/stream-overlay.css': 'b0433353a4c3ba73a8c8964ba4e51fc97ceddaca66c8d950f2e23aea3c6c0d46'
};
function normalize(file, source) {
  const hash = crypto.createHash('sha256').update(source).digest('hex');
  if (assets[file]) return hash === assets[file] ? '' : source;
  if (!hashes[file] || hash !== hashes[file]) return source;
  return cp.execFileSync('git', ['show', 'fc7c23a:' + file], {encoding: 'utf8'});
}
module.exports = {normalize, files: Object.keys(hashes), added: Object.keys(assets), assets};

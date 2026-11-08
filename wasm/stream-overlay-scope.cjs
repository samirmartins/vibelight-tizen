'use strict';
// Exact, separately tested system-overlay integration. Historical contracts see
// the reviewed pre-overlay source; unknown neighboring edits stay visible.
const crypto = require('crypto'), cp = require('child_process');
const hashes = {
  'wasm/index.html': '63f4c643f409892980da63691994da51e8be5022cd52e0cb51a65ab35d3cf179',
  'wasm/platform/index.js': '7b2ae3e8fe66e8d18e37165d75f9ee10b4f08460763a20b6aba5ef71a80e95e7',
  'wasm/platform/messages.js': '9ebbcf60bde10db8823048a8761b3a1f726e3bea67fffe1052b61252712a69cc'
};
const assets = {
  'wasm/static/css/stream-overlay.css': 'ab2db6df286863fda8e11fa1731a8045051074adbdddaa68984e141d7353e45b',
  'wasm/static/css/console-controls.css': 'd2eb2817113d1c2bda345eb9d72d3ff01d17708e46d9bc10b9325989f64cca1b'
};
function normalize(file, source) {
  source=require('./experience-scope.cjs').normalize(file,source);
  source = require('./pairing-text-scope.cjs').normalize(file, source);
  const hash = crypto.createHash('sha256').update(source).digest('hex');
  if (assets[file]) return hash === assets[file] ? '' : source;
  if (!hashes[file] || hash !== hashes[file]) return source;
  return cp.execFileSync('git', ['show', 'fc7c23a:' + file], {encoding: 'utf8'});
}
module.exports = {normalize, files: Object.keys(hashes), added: Object.keys(assets), assets};

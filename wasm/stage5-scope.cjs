'use strict';
// Exact Stage 5 cleanup for files without a dedicated historical scope:
// the unused remote-controller activity flag. Other Stage 5 files are pinned
// by their existing scopes (index, navigation, lifecycle and mapping menu).
const crypto = require('crypto'), cp = require('child_process');
const hashes = {
  'wasm/platform/index.js': '6b6462d99be75ed011412e4d2fb4966c705771314107f3826d40a7c043bcd30c',
  'wasm/platform/navigation.js': 'f513ae9ae535c2b16c46f593a327b0fcf89d9b16aa16df1dd31e39cc955ea1cf',
  'wasm/platform/app-lifecycle.js': 'f35bfca1aa8bcf21c24980e6b16e947eb20232c37b4ff8b8316fdece9be82ae2',
  'wasm/platform/controller-mapping-menu.js': 'd2cd612615f2f1a16d7c3b83d57467a7ded959d3f67fd7999587c336d2b044a2',
  'wasm/platform/remote_controller.js': 'b4201bda42150e280df263203cdbebd9feaa476188f4aebdb38869af336e8b74'
};
function normalize(file, source) {
  source = require('./pairing-text-scope.cjs').normalize(file, source);
  if (!hashes[file] || crypto.createHash('sha256').update(source).digest('hex') !== hashes[file]) return source;
  return cp.execFileSync('git', ['show', '31cdde3:' + file], {encoding: 'utf8'});
}
module.exports = {normalize, files: Object.keys(hashes)};

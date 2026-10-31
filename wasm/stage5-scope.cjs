'use strict';
// Exact Stage 5 cleanup for files without a dedicated historical scope:
// the unused remote-controller activity flag. Other Stage 5 files are pinned
// by their existing scopes (index, navigation, lifecycle and mapping menu).
const crypto = require('crypto'), cp = require('child_process');
const hashes = {
  'wasm/platform/index.js': '6b6462d99be75ed011412e4d2fb4966c705771314107f3826d40a7c043bcd30c',
  'wasm/platform/navigation.js': 'f513ae9ae535c2b16c46f593a327b0fcf89d9b16aa16df1dd31e39cc955ea1cf',
  'wasm/platform/app-lifecycle.js': 'f35bfca1aa8bcf21c24980e6b16e947eb20232c37b4ff8b8316fdece9be82ae2',
  'wasm/platform/controller-mapping-menu.js': 'f0ff46403e3b8b06ad6545ba07f1a9fda04a5c09b85df0d3be80f1f444cef0b8',
  'wasm/platform/remote_controller.js': 'b4201bda42150e280df263203cdbebd9feaa476188f4aebdb38869af336e8b74'
};
function normalize(file, source) {
  if (!hashes[file] || crypto.createHash('sha256').update(source).digest('hex') !== hashes[file]) return source;
  return cp.execFileSync('git', ['show', '31cdde3:' + file], {encoding: 'utf8'});
}
module.exports = {normalize, files: Object.keys(hashes)};

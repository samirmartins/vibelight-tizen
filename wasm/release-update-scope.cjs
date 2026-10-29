'use strict';
// Exact release-notice and startup-artwork changes; unknown neighboring edits remain visible.
const hashes = {
  'wasm/static/css/style.css': '1367b5f4a64155273c296af3d00bca09f52ac606de79c9d5cf0b82345eb7a987',
  'wasm/index.html': 'da08f1419d8eec229fdb3c1225d59007745175b2ae0cfb408ad2a3a9084d30cc',
  'wasm/platform/console-library.js': '35c104ecb9099b93bc565eae8366e82cd8707ae93cbcd00a60319423ab3d2869'
};
function normalize(file, source) {
  if (!hashes[file] || require('crypto').createHash('sha256').update(source).digest('hex') !== hashes[file]) return source;
  return require('child_process').execFileSync('git', ['show', 'v3.4.14:' + file], {encoding: 'utf8'});
}
module.exports = {normalize};

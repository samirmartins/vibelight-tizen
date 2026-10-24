'use strict';
// Exact opt-in integration exceptions for historical frozen-source tests.
// The real ON/OFF implementation is exercised separately by frame_pacing_test.
// Unknown neighboring changes are never normalized away.
const cp = require('child_process'), crypto = require('crypto');
const approved = {
  'moonlight-common-c/src/VideoDepacketizer.c': 'afef183d378307378d68ea1765276fa488813ec25a8672dcb5f990d2aa0013e0',
  'moonlight-common-c/src/VideoPacing.h': 'c8efd3d0e1ff13bdd7c9a85e1d20a37cbeacad150ca0a63fab1cb839327344c6',
  'wasm/frame_pacing.hpp': 'bb34dc065b524c18640525c3145cae9ff3f3b910d041a32727be876e4868b780',
  'wasm/main.cpp': '8ef09c860927ddecc9a6d85ed5b99df27088ac3f57aed5fbbf61fb23b0ade97a',
  'wasm/moonlight_wasm.hpp': '7d84a39d58498bd4c19594cf0e790b5760f9abbcfffce44231b7617d5f70ff78',
  'wasm/wasmplayer.cpp': '39afb1eba49abf8d7382fbef4aff6626f28fedfada480b18c572e0af77a47b13',
  'wasm/platform/index.js': 'a0a5ebb91301e4333244eddb6e1bb52567bd5e2724b2d5e4c49185d452ce6762',
  'wasm/platform/navigation.js': '583841994ded672007d1f99b36c505ce0a7ac785c5dfa6ab0e98284bbe9eb036',
  'wasm/index.html': '33e046efdd1c82088d841d8341f21a68619078312707a4ad5ea7cbd8723ec1b1',
  'wasm/static/css/style.css': '9d766ee81d0a6d8cfeee0e62fcbc9489c8e6e12517b3c0fd141dcfd1af541e0c'
};
const added = ['moonlight-common-c/src/VideoPacing.h', 'wasm/frame_pacing.hpp'];
function normalize(file, source) {
  if (!approved[file] || crypto.createHash('sha256').update(source).digest('hex') !== approved[file]) return source;
  if (added.includes(file)) return '';
  return cp.execFileSync('git', ['show', 'v3.4.11:' + file], {encoding: 'utf8'});
}
function launch(source) {
  return source.replace(
    "      // Freeze the experimental preference for this stream; Play and Resume share it.\n" +
    "      const framePacing = $('#framePacingSwitch').parent().hasClass('is-checked') ? 1 : 0;",
    '      // Frames are handed over as soon as they are complete; there is nothing\n' +
    '      // left to pace. Kept in the call signature so the binding is unchanged.\n' +
    '      const framePacing = 0;');
}
module.exports = {normalize, launch, files: Object.keys(approved), added};

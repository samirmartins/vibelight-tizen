'use strict';
// Approved pairing copy: recommend VibeShine while preserving historical
// contracts that predate the host recommendation. Revert only the exact
// reviewed file; any neighboring edit stays visible.
const crypto = require('crypto');
const before = 'If your host PC is running Sunshine (all GPUs), navigate to the Sunshine Web UI to enter the PIN.';
const after = 'If your host PC is running VibeShine (recommended) or Sunshine (all GPUs), open the VibeShine or Sunshine web interface to enter the PIN.';
const approved = '7b2ae3e8fe66e8d18e37165d75f9ee10b4f08460763a20b6aba5ef71a80e95e7';
function normalize(file, source) {
  source = require('./review-corrections-scope.cjs').normalize(file, source);
  source = require('./session-transition-scope.cjs').normalize(file, source);
  if (file !== 'wasm/platform/index.js' || !source.includes(after)) return source;
  const reverted = source.replace(after, before);
  return crypto.createHash('sha256').update(reverted).digest('hex') === approved ? reverted : source;
}
module.exports = {normalize};

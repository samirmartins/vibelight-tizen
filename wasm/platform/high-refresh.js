// Experimental 120 FPS. The option is offered only on a panel whose measured refresh rate is
// close to 120 Hz and is never forced on any other: a stored or chosen 120 on a panel that does
// not report it becomes 60. A guard remembers a 120 FPS start that did not finish (a freeze or a
// failure) so the next launch of the app returns to 60 FPS once. Pure rules: no DOM, no timers.
var HighRefresh = (function() {
  'use strict';
  var RATE = '120', MIN_X100 = 11500, MAX_X100 = 24000;
  var KEY = 'vibelight.high-refresh.pending';

  // x100: the measured display refresh in hundredths of Hz (display.js), e.g. 12000 for 120 Hz.
  function supported(x100) {
    return typeof x100 === 'number' && isFinite(x100) && x100 >= MIN_X100 && x100 <= MAX_X100;
  }
  function effective(rate, x100) {
    var text = String(rate);
    return text === RATE && !supported(x100) ? '60' : text;
  }

  function arm(storage) {
    try { storage.setItem(KEY, '1'); } catch (e) { /* the guard is best effort */ }
  }
  function disarm(storage) {
    try { storage.removeItem(KEY); } catch (e) { /* the guard is best effort */ }
  }
  function interrupted(storage) {
    try { return storage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  // At start-up: {rate, recovered}. An interrupted start with 120 chosen yields 60 once; a stale
  // guard with another rate is just cleared.
  function recover(storage, rate) {
    var text = String(rate);
    if (!interrupted(storage)) return { rate: text, recovered: false };
    disarm(storage);
    return text === RATE ? { rate: '60', recovered: true } : { rate: text, recovered: false };
  }

  return { supported: supported, effective: effective, arm: arm, disarm: disarm, interrupted: interrupted, recover: recover, RATE: RATE };
})();

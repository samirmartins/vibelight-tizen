// Ends the current stream from the system overlay. Native termination remains
// the only path back to the library: "Disconnect" and "End game on PC" both
// converge on one native stop and never open a second return path.
var StreamSession = (function() {
  var pending = null; // 'disconnect' | 'endHostGame' while one action owns the end

  function overlay() {
    return typeof StreamOverlay !== 'undefined' ? StreamOverlay : null;
  }

  function releaseSuppression() {
    var menu = overlay();
    if (menu && typeof menu.release === 'function') {
      menu.release();
      return;
    }
    try {
      if (typeof Module !== 'undefined' && typeof Module._setInputSuppressed === 'function') {
        Module._setInputSuppressed(0);
      }
    } catch (e) { /* The next stream start also clears suppression. */ }
  }

  function stopNative() {
    try {
      if (typeof Module !== 'undefined' && typeof Module.stopStream === 'function') {
        Module.stopStream();
        return true;
      }
    } catch (e) { /* Report as a failed stop below. */ }
    return false;
  }

  function failedStop(menu) {
    pending = null;
    releaseSuppression();
    if (menu && typeof menu.failed === 'function') menu.failed('Could not stop the stream.');
  }

  // Idempotent: the first request owns the stop until native termination.
  function disconnect() {
    if (pending) return false;
    pending = 'disconnect';
    var menu = overlay();
    // Keep native suppression until the stream is gone, so no held overlay
    // button reaches the host during teardown.
    if (menu && typeof menu.hide === 'function') menu.hide();
    if (!stopNative()) {
      failedStop(menu);
      return false;
    }
    return true;
  }

  // Idempotent and confirmed by the caller. The overlay stays visible while the
  // host answers; a failure keeps the session alive instead of stranding it.
  function endHostGame() {
    if (pending) return false;
    var host = typeof api !== 'undefined' ? api : null;
    if (!host || typeof host.quitApp !== 'function') return false;
    pending = 'endHostGame';
    var menu = overlay();
    if (menu && typeof menu.busy === 'function') menu.busy(true);
    host.quitApp().then(function() {
      if (pending !== 'endHostGame') return;
      // Hide now but keep the native mask until native termination, so the A
      // that confirmed the dialog is never delivered to the closing game.
      if (menu && typeof menu.hide === 'function') menu.hide();
      if (!stopNative()) failedStop(menu);
    }, function() {
      if (pending !== 'endHostGame') return;
      pending = null;
      if (menu) {
        if (typeof menu.busy === 'function') menu.busy(false);
        if (typeof menu.failed === 'function') {
          menu.failed('Could not close the game on the PC.');
        }
      }
    });
    return true;
  }

  // Called by the single native termination handler before it returns to the
  // library. Releases the mask even when the stream ended without the overlay.
  function terminated() {
    pending = null;
    releaseSuppression();
    var menu = overlay();
    if (menu && typeof menu.close === 'function') menu.close(true);
  }

  function reset() { pending = null; }

  return {
    disconnect: disconnect,
    endHostGame: endHostGame,
    terminated: terminated,
    reset: reset,
    isPending: function() { return pending !== null; }
  };
})();

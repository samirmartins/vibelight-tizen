// Shared menu-only directional input. The streaming publisher never uses this state.
var LibraryNavigation = (function() {
  var pads = Object.create(null), owner = null, direction = null, timer = null, epoch = 0, nextRepeatAt = 0;
  var activate = 0.5, release = 0.35, initialDelay = 350, repeatInterval = 100;
  // Digital buttons mirror the stick hysteresis: act on the first press, then
  // require a stable release before accepting another edge from the same pad.
  var buttonRelease = 50;

  function available() {
    return !isInGame && !document.hidden &&
      (typeof Navigation.isRunning !== 'function' || Navigation.isRunning());
  }
  function cancelRepeat() {
    ++epoch;
    clearTimeout(timer); timer = null; direction = null; owner = null;
  }
  function reset() { cancelRepeat(); nextRepeatAt = 0; pads = Object.create(null); }
  function viewChanged() {
    // Retain held directions as suppressed until release or a new direction.
    // A stick held at a view boundary must not immediately move its new menu.
    cancelRepeat();
    nextRepeatAt = 0;
  }
  function disconnect(index) {
    delete pads[index];
    if (owner === index) cancelRepeat();
  }
  function showAppsView() {
    if (typeof Navigation === 'undefined' || typeof Views === 'undefined' || !Views.Apps) return;
    if (typeof Navigation.isRunning === 'function' && !Navigation.isRunning()) return;
    if (typeof Navigation.change === 'function') Navigation.change(Views.Apps);
  }
  function filterStep(delta) {
    if (isDialogOpen || isInGame || typeof ConsoleLibrary === 'undefined' || !ConsoleLibrary.visible()) return;
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    showAppsView();
    var names = ['All', 'Favorites', 'Recent'], current = 0;
    for (var i = 0; i < names.length; i++) {
      var pressed = document.getElementById('library' + names[i]);
      if (pressed && typeof pressed.getAttribute === 'function' &&
          pressed.getAttribute('aria-pressed') === 'true') current = i;
    }
    var target = document.getElementById('library' + names[(current + delta + names.length) % names.length]);
    if (target && typeof target.click === 'function') target.click();
  }
  function pageStep(delta) {
    if (isDialogOpen || isInGame || typeof ConsoleLibrary === 'undefined' || !ConsoleLibrary.visible()) return;
    // One page is two card rows; ConsoleLibrary.move clamps at the list edges.
    showAppsView();
    if (typeof ConsoleLibrary.move === 'function') ConsoleLibrary.move(0, delta * 2);
  }
  function showQuickHelp() {
    if (isInGame || typeof QuickHelp === 'undefined') return;
    if (typeof isDialogOpen !== 'undefined' && isDialogOpen && !QuickHelp.isOpen()) return;
    QuickHelp.toggle();
  }
  function showGuide() {
    if (isDialogOpen || isInGame) return;
    if (typeof navigationGuideDialog === 'function') {
      navigationGuideDialog();
    } else if (typeof QuickHelp !== 'undefined') {
      QuickHelp.open();
    }
  }
  function axis(value, previous) {
    if (value > activate) return 1;
    if (value < -activate) return -1;
    return Math.abs(value) > release && value * previous > 0 ? previous : 0;
  }
  // One digital state for sticks and action buttons. A fresh press must follow
  // a stable release; directional repeats keep their separate scheduling.
  function digital(pad, index, pressed, now) {
    var state = pad.buttons[index];
    if (!state) state = pad.buttons[index] = {pressed: false, releasedAt: -1e9};
    var fresh = false;
    if (pressed) {
      fresh = !state.pressed && now - state.releasedAt >= buttonRelease;
      state.pressed = true;
    } else {
      state.pressed = false;
      state.releasedAt = now;
    }
    return fresh;
  }
  function choose(pad, current) {
    var x = Number(!!(pad.buttons[15] && pad.buttons[15].pressed)) -
      Number(!!(pad.buttons[14] && pad.buttons[14].pressed));
    var y = Number(!!(pad.buttons[13] && pad.buttons[13].pressed)) -
      Number(!!(pad.buttons[12] && pad.buttons[12].pressed));
    var digitalPressed = pad.buttons[12] && pad.buttons[12].pressed ||
      pad.buttons[13] && pad.buttons[13].pressed ||
      pad.buttons[14] && pad.buttons[14].pressed ||
      pad.buttons[15] && pad.buttons[15].pressed;
    if (!digitalPressed) { x = pad.x; y = pad.y; }
    var horizontal = x < 0 ? 'left' : x > 0 ? 'right' : null;
    var vertical = y < 0 ? 'up' : y > 0 ? 'down' : null;
    if (horizontal && vertical) {
      // Keep a stable axis near a diagonal, rather than alternating on noise.
      if (digitalPressed) return current === vertical ? vertical : horizontal;
      if (current === horizontal && Math.abs(pad.axes[1]) <= Math.abs(pad.axes[0]) + 0.15) return horizontal;
      if (current === vertical && Math.abs(pad.axes[0]) <= Math.abs(pad.axes[1]) + 0.15) return vertical;
      return Math.abs(pad.axes[0]) >= Math.abs(pad.axes[1]) ? horizontal : vertical;
    }
    return horizontal || vertical;
  }
  function schedule(delay, token) {
    timer = setTimeout(function() {
      if (token !== epoch) return;
      timer = null;
      if (!available()) { reset(); return; }
      Navigation[direction]();
      if (token === epoch && available()) {
        nextRepeatAt += repeatInterval;
        schedule(repeatInterval, token);
      }
      else if (token === epoch) reset();
    }, delay);
  }
  function handle(detail) {
    // Consume paused/hidden menu input too; do not restart the legacy repeater.
    if (!available()) { reset(); return true; }
    var index = detail.padIndex === undefined ? 0 : detail.padIndex;
    var pad = pads[index];
    if (!pad) pad = pads[index] = {buttons: Object.create(null), axes: [0, 0, 0, 0], x: 0, y: 0, rightDir: 0};
    var accept = 0, back = 1, identityLoaded = false;
    var action = null, extra = null, dpadBounce = false, now = Date.now();
    // Resolve the complete poll before choosing a direction: release order is
    // not meaningful when left and right change together.
    detail.changes.forEach(function(change) {
      if (change.type === 'button') {
        if (!identityLoaded) {
          identityLoaded = true;
          if (typeof ControllerIdentity !== 'undefined') {
            var family = ControllerIdentity.familyAt(index);
            accept = family === 'nintendo' ? 1 : 0;
            back = family === 'nintendo' ? 0 : 1;
          }
        }
        if ((change.index >= 4 && change.index <= 9) || change.index === 3 || change.index === 16 ||
            (change.index >= 12 && change.index <= 15) ||
            change.index === accept || change.index === back) {
          var fresh = digital(pad, change.index, !!change.pressed, now);
          if (change.index >= 12 && change.index <= 15) {
            if (change.pressed && !fresh) dpadBounce = true;
          } else if (change.pressed && fresh) {
            if (change.index === accept) action = 'accept';
            else if (change.index === back) action = 'back';
            else if (change.index === 3 || change.index === 8) action = 'press';
            else if (change.index === 4) extra = function() { filterStep(-1); };
            else if (change.index === 5) extra = function() { filterStep(1); };
            else if (change.index === 6) extra = function() { pageStep(-1); };
            else if (change.index === 7) extra = function() { pageStep(1); };
            else if (change.index === 9) extra = showQuickHelp;
            else if (change.index === 16) extra = showGuide;
          }
        }
      } else if (change.type === 'axis' && change.index >= 0 && change.index <= 3) {
        pad.axes[change.index] = Number.isFinite(change.value) ? change.value : 0;
      }
    });
    pad.x = axis(pad.axes[0], pad.x); pad.y = axis(pad.axes[1], pad.y);
    var rightDir = pad.axes[3] > 0.6 ? 1 : pad.axes[3] < -0.6 ? -1 : 0;
    if (rightDir && rightDir !== pad.rightDir) extra = function() { pageStep(rightDir); };
    pad.rightDir = rightDir;
    var previous = pad.direction || null;
    var next = choose(pad, previous);
    pad.direction = next;
    if (action) {
      // Gamepad events already carry edges; act in the same poll. The remote
      // controller calls Navigation directly and keeps that behavior.
      viewChanged();
      if (!available()) { reset(); return true; }
      Navigation[action]();
      return true;
    }
    // A simultaneous direction keeps the historical movement priority; a
    // filter/page/help press is consumed only in a poll with no movement.
    if (extra && !next) { extra(); return true; }
    // A contact bounce repeats the direction that was already held. Resume the
    // planned cadence instead of emitting a second step or stealing focus.
    if (dpadBounce && next && next === pad.lastDirection) {
      if (owner !== null && owner !== index) return true;
      if (owner === index && timer) return true;
      // A view change cancelled the cadence: keep the held direction suppressed.
      if (!nextRepeatAt) return true;
      cancelRepeat();
      owner = index; direction = next;
      var resumeAt = Math.max(nextRepeatAt, now + repeatInterval);
      nextRepeatAt = resumeAt;
      schedule(resumeAt - now, epoch);
      return true;
    }
    // A different pad's unchanged held direction/noise must not steal focus.
    if (owner !== index && (!next || next === previous)) return true;
    if (owner === index && next === direction) return true;
    cancelRepeat();
    if (!next) return true;
    owner = index; direction = next;
    pad.lastDirection = next;
    var token = epoch;
    Navigation[direction]();
    if (token === epoch && available()) {
      nextRepeatAt = now + initialDelay;
      schedule(initialDelay, token);
    }
    else if (token === epoch) reset();
    return true;
  }
  return {handle: handle, reset: reset, disconnect: disconnect, viewChanged: viewChanged};
})();

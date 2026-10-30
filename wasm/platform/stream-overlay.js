// In-stream system overlay. Native input is suppressed through one atomic
// flag; the overlay polls the browser gamepads only while it is open (or while
// releasing the mask), never during normal gameplay.
var StreamOverlay = (function() {
  var CONFIG_KEY = 'vibelight.stream-overlay.v1';
  var DEFAULT_STEP = 5;
  var RELEASE_TIMEOUT_MS = 1500;
  var REPEAT_DELAY_MS = 400;
  var REPEAT_INTERVAL_MS = 120;
  var REFRESH_INTERVAL_MS = 250;
  var NEUTRAL_AXIS = 0.25;

  var config = {volumeStep: DEFAULT_STEP};
  var built = false, open = false, closing = false, busy = false, confirm = false;
  var maskState = 0;
  var root = null, title = null, status = null, list = null, confirmBox = null;
  var confirmText = null, noticeEl = null;
  var actionButtons = [], confirmButtons = [];
  var frameHandle = 0, releaseTimer = 0, nextRefresh = 0, lastToggleAt = 0;
  var resumeFocus = false;
  var pads = Object.create(null), lost = Object.create(null);
  var errorText = '';

  function translate(value) {
    return typeof MenuI18n !== 'undefined' && typeof MenuI18n.text === 'function'
      ? MenuI18n.text(value) : value;
  }

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function create(tag, id, className, text) {
    var node = document.createElement(tag);
    if (id) node.id = id;
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setSuppressed(value) {
    var next = value ? 1 : 0;
    if (maskState === next) return;
    maskState = next;
    try {
      if (typeof Module !== 'undefined' && typeof Module._setInputSuppressed === 'function') {
        Module._setInputSuppressed(next);
      }
    } catch (e) { /* The native session start clears suppression too. */ }
  }

  function loadConfig() {
    var raw = null;
    try { raw = localStorage.getItem(CONFIG_KEY); } catch (e) { raw = null; }
    return normalizeConfig(raw);
  }

  function normalizeConfig(raw) {
    var parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    var step = Number(parsed.volumeStep);
    if (!isFinite(step)) step = DEFAULT_STEP;
    step = Math.max(1, Math.min(20, Math.round(step)));
    return {volumeStep: step};
  }

  function configure(patch) {
    config = normalizeConfig(JSON.stringify({
      volumeStep: patch && typeof patch === 'object' ? patch.volumeStep : config.volumeStep
    }));
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (e) {}
    return config;
  }

  function volumeApi() {
    try {
      if (typeof tizen !== 'undefined' && tizen.tvaudiocontrol) {
        var control = tizen.tvaudiocontrol;
        if (typeof control.getVolume === 'function' || typeof control.setVolume === 'function' ||
            typeof control.setVolumeUp === 'function') return control;
      }
    } catch (e) {}
    return null;
  }

  function volumeLabel() {
    var control = volumeApi();
    if (!control) return translate('Volume: unavailable');
    try {
      if (typeof control.getMute === 'function' && control.getMute()) return translate('Volume: muted');
      if (typeof control.getVolume === 'function') {
        var level = Number(control.getVolume());
        if (isFinite(level)) return translate('Volume: ' + Math.round(level) + '%');
      }
    } catch (e) {}
    return translate('Volume');
  }

  function statsOn() {
    var toggle = document.getElementById('performanceStatsSwitch');
    return !!(toggle && toggle.checked);
  }

  function statsLabel() {
    return translate(statsOn() ? 'Statistics: On' : 'Statistics: Off');
  }

  function adjustVolume(delta) {
    var control = volumeApi();
    if (!control || !delta) return;
    try {
      if (typeof control.getMute === 'function' && control.getMute() && typeof control.setMute === 'function') {
        control.setMute(false);
      }
      if (typeof control.getVolume === 'function' && typeof control.setVolume === 'function') {
        var current = Number(control.getVolume());
        if (isFinite(current)) {
          control.setVolume(Math.max(0, Math.min(100, Math.round(current + delta * config.volumeStep))));
        }
      } else if (delta > 0 && typeof control.setVolumeUp === 'function') {
        control.setVolumeUp();
      } else if (delta < 0 && typeof control.setVolumeDown === 'function') {
        control.setVolumeDown();
      }
    } catch (e) {}
    refresh();
  }

  function toggleMute() {
    var control = volumeApi();
    if (!control) return;
    try {
      if (typeof control.setMute === 'function') {
        var muted = typeof control.getMute === 'function' && control.getMute();
        control.setMute(!muted);
      }
    } catch (e) {}
    refresh();
  }

  function toggleStats() {
    try {
      if (typeof Module !== 'undefined' && typeof Module.toggleStats === 'function') Module.toggleStats();
    } catch (e) {}
    refresh();
  }

  function actions() {
    return [
      {id: 'resume', label: function() { return translate('Resume'); },
       run: function() { close(); }},
      {id: 'volume', label: volumeLabel,
       adjust: function(delta) { adjustVolume(delta); },
       run: toggleMute},
      {id: 'stats', label: statsLabel, run: toggleStats},
      {id: 'disconnect', label: function() { return translate('Disconnect'); },
       run: function() {
         if (typeof StreamSession === 'undefined' || !StreamSession.disconnect()) {
           failed('Could not stop the stream.');
         }
       }},
      {id: 'end', label: function() { return translate('End game on PC'); },
       run: askEndGame}
    ];
  }

  function build() {
    if (built) return;
    root = create('div', 'streamOverlay');
    root.hidden = true;
    var panel = create('div', 'streamOverlayPanel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'streamOverlayTitle');
    title = create('h3', 'streamOverlayTitle', 'stream-overlay-title');
    status = create('div', 'streamOverlayStatus', 'stream-overlay-status');
    status.setAttribute('aria-live', 'polite');
    list = create('div', 'streamOverlayActions', 'stream-overlay-actions');
    var defs = actions();
    actionButtons = [];
    for (var i = 0; i < defs.length; i++) {
      var button = create('button', 'streamOverlay-' + defs[i].id, 'console-button');
      button.setAttribute('type', 'button');
      button.setAttribute('data-action', defs[i].id);
      list.appendChild(button);
      actionButtons.push(button);
    }
    confirmBox = create('div', 'streamOverlayConfirm', 'stream-overlay-confirm');
    confirmBox.hidden = true;
    confirmText = create('p', 'streamOverlayConfirmText', 'stream-overlay-confirm-text');
    var confirmActions = create('div', null, 'stream-overlay-confirm-actions');
    confirmButtons = [];
    ['Yes', 'No'].forEach(function(label) {
      var button = create('button', 'streamOverlayConfirm' + label, 'console-button');
      button.setAttribute('type', 'button');
      button.textContent = label;
      confirmActions.appendChild(button);
      confirmButtons.push(button);
    });
    confirmBox.appendChild(confirmText);
    confirmBox.appendChild(confirmActions);
    panel.appendChild(title);
    panel.appendChild(status);
    panel.appendChild(list);
    panel.appendChild(confirmBox);
    root.appendChild(panel);
    document.body.appendChild(root);

    noticeEl = create('div', 'streamOverlayNotice', 'stream-overlay-notice');
    noticeEl.hidden = true;
    document.body.appendChild(noticeEl);
    built = true;
  }

  function refresh() {
    if (!built || (!open && !closing)) return;
    setText(title, translate('Stream menu'));
    setText(status, busy ? translate('Ending the game on the PC...') : translate(errorText));
    var defs = actions();
    for (var i = 0; i < defs.length && i < actionButtons.length; i++) {
      setText(actionButtons[i], defs[i].label());
    }
    setText(confirmText, translate('End the game on the PC?') + ' ' +
      translate('The running game will be closed. Unsaved progress may be lost.'));
    setText(confirmButtons[0], translate('Yes'));
    setText(confirmButtons[1], translate('No'));
  }

  function startFrames() {
    if (frameHandle || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
    frameHandle = window.requestAnimationFrame(tick);
  }

  function stopFrames() {
    if (!frameHandle) return;
    try { window.cancelAnimationFrame(frameHandle); } catch (e) {}
    frameHandle = 0;
  }

  function focusCanvas() {
    if (typeof isInGame !== 'undefined' && !isInGame) return;
    var canvas = document.getElementById('wasm_module');
    if (canvas && typeof canvas.focus === 'function') {
      try { canvas.focus(); } catch (e) {}
    }
  }

  function finishClose() {
    closing = false;
    open = false;
    stopFrames();
    if (releaseTimer) {
      clearTimeout(releaseTimer);
      releaseTimer = 0;
    }
    setSuppressed(0);
    if (resumeFocus) {
      resumeFocus = false;
      focusCanvas();
    }
    notice();
  }

  function openMenu() {
    if (open || closing) return false;
    if (typeof isInGame !== 'undefined' && !isInGame) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    if (typeof StreamSession !== 'undefined' && StreamSession.isPending()) return false;
    config = loadConfig();
    build();
    errorText = '';
    busy = false;
    confirm = false;
    root.hidden = false;
    list.hidden = false;
    confirmBox.hidden = true;
    open = true;
    pads = Object.create(null);
    resumeFocus = false;
    setSuppressed(1);
    FocusManager.open(actionButtons, 0);
    refresh();
    nextRefresh = 0;
    startFrames();
    return true;
  }

  // hide() removes the panel but keeps the native mask while the stream stops.
  function hide() {
    if (!open) return;
    open = false;
    confirm = false;
    busy = false;
    errorText = '';
    root.hidden = true;
    confirmBox.hidden = true;
    FocusManager.close();
    stopFrames();
  }

  function close(force) {
    if (force) {
      if (!built) return true;
      open = false;
      confirm = false;
      busy = false;
      errorText = '';
      resumeFocus = false;
      root.hidden = true;
      noticeEl.hidden = true;
      lost = Object.create(null);
      FocusManager.close();
      finishClose();
      return true;
    }
    if (!open) return false;
    // Hide the panel now, but keep the native mask until every gesture that
    // closed it is released. Otherwise the same button becomes a fresh host
    // press on resume.
    open = false;
    confirm = false;
    busy = false;
    errorText = '';
    root.hidden = true;
    confirmBox.hidden = true;
    FocusManager.close();
    closing = true;
    resumeFocus = true;
    startFrames();
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(function() {
      releaseTimer = 0;
      if (closing) finishClose();
    }, RELEASE_TIMEOUT_MS);
    return true;
  }

  function toggle() {
    // Two pads can raise Guide in the same poll; one message must open once.
    var now = Date.now();
    if (now - lastToggleAt < 250) return false;
    lastToggleAt = now;
    return open ? close() : openMenu();
  }

  function busyState(value) {
    busy = !!value;
    refresh();
  }

  function failed(message) {
    if (!open) {
      if (!openMenu()) return;
    }
    errorText = message;
    refresh();
  }

  function askEndGame() {
    if (busy) return;
    confirm = true;
    errorText = '';
    list.hidden = true;
    confirmBox.hidden = false;
    FocusManager.open(confirmButtons, 0);
    refresh();
  }

  function cancelConfirm() {
    confirm = false;
    confirmBox.hidden = true;
    list.hidden = false;
    FocusManager.open(actionButtons, 4);
    refresh();
  }

  function accept() {
    if (busy) return;
    if (confirm) {
      var chosen = FocusManager.index();
      if (chosen === 0) {
        busy = true;
        refresh();
        if (typeof StreamSession === 'undefined' || !StreamSession.endHostGame()) {
          busy = false;
          failed('Could not close the game on the PC.');
        }
      } else {
        cancelConfirm();
      }
      return;
    }
    var defs = actions(), index = FocusManager.index();
    if (defs[index] && typeof defs[index].run === 'function') defs[index].run();
  }

  function back() {
    if (busy) return;
    if (confirm) { cancelConfirm(); return; }
    close();
  }

  function step(direction) {
    if (confirm) {
      FocusManager.move(direction === 'up' || direction === 'left' ? -1 : 1);
      return;
    }
    var defs = actions(), index = FocusManager.index();
    if (direction === 'left' || direction === 'right') {
      if (defs[index] && typeof defs[index].adjust === 'function') {
        defs[index].adjust(direction === 'right' ? 1 : -1);
        return;
      }
    }
    FocusManager.move(direction === 'up' || direction === 'left' ? -1 : 1);
  }

  function buttonPressed(pad, index) {
    var button = pad.buttons ? pad.buttons[index] : null;
    return !!(button && button.pressed);
  }

  function axisValue(pad, index) {
    var value = pad.axes && pad.axes[index] !== undefined ? Number(pad.axes[index]) : 0;
    return isFinite(value) ? value : 0;
  }

  function directionOf(state) {
    if (state.up) return 'up';
    if (state.down) return 'down';
    if (state.left) return 'left';
    if (state.right) return 'right';
    return null;
  }

  function sample(state, pad) {
    state.up = buttonPressed(pad, 12) || axisValue(pad, 1) < -0.6;
    state.down = buttonPressed(pad, 13) || axisValue(pad, 1) > 0.6;
    state.left = buttonPressed(pad, 14) || axisValue(pad, 0) < -0.6;
    state.right = buttonPressed(pad, 15) || axisValue(pad, 0) > 0.6;
    for (var i = 0; i < 17; i++) state.buttons[i] = buttonPressed(pad, i);
  }

  function pollPads(now) {
    var padsNow = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < padsNow.length; i++) {
      var pad = padsNow[i];
      if (!pad || !pad.connected) continue;
      var state = pads[pad.index];
      if (!state) {
        state = pads[pad.index] = {buttons: Object.create(null), primed: false};
        sample(state, pad);
        state.direction = directionOf(state);
        // A direction already held when the menu opens stays inert until it is
        // released and pressed again; only a fresh gesture may navigate.
        state.nextRepeatAt = state.direction ? Infinity : now + REPEAT_DELAY_MS;
        state.primed = true;
        continue;
      }
      var previous = Object.create(null);
      for (var button = 0; button < 17; button++) previous[button] = !!state.buttons[button];
      sample(state, pad);
      var guide = state.buttons[16] || (state.buttons[8] && state.buttons[9]);
      if (guide && !(previous[16] || (previous[8] && previous[9]))) { close(); return; }
      if (busy) continue;
      if (state.buttons[1] && !previous[1]) { back(); return; }
      if (state.buttons[0] && !previous[0]) { accept(); return; }
      var direction = directionOf(state);
      if (direction !== state.direction) {
        state.direction = direction;
        if (direction) {
          state.nextRepeatAt = now + REPEAT_DELAY_MS;
          step(direction);
          return;
        }
      } else if (direction && now >= state.nextRepeatAt) {
        state.nextRepeatAt = now + REPEAT_INTERVAL_MS;
        step(direction);
        return;
      }
    }
  }

  function neutralNow() {
    var padsNow = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < padsNow.length; i++) {
      var pad = padsNow[i];
      if (!pad || !pad.connected) continue;
      for (var button = 0; button < (pad.buttons ? pad.buttons.length : 0); button++) {
        if (buttonPressed(pad, button)) return false;
      }
      for (var axis = 0; axis < (pad.axes ? pad.axes.length : 0); axis++) {
        if (Math.abs(axisValue(pad, axis)) > NEUTRAL_AXIS) return false;
      }
    }
    return true;
  }

  function tick(timestamp) {
    frameHandle = 0;
    if (!open && !closing) return;
    var now = typeof timestamp === 'number' ? timestamp : Date.now();
    if (open) {
      pollPads(now);
      if (open && now >= nextRefresh) {
        nextRefresh = now + REFRESH_INTERVAL_MS;
        refresh();
      }
    } else if (closing && neutralNow()) {
      finishClose();
      return;
    }
    if ((open || closing) && !frameHandle) frameHandle = window.requestAnimationFrame(tick);
  }

  function notice() {
    if (!noticeEl) return;
    var count = Object.keys(lost).length;
    if (!count || (typeof isInGame !== 'undefined' && !isInGame)) {
      noticeEl.hidden = true;
      return;
    }
    noticeEl.textContent = translate(count === 1 ? 'Controller disconnected' : 'Controllers disconnected');
    noticeEl.hidden = false;
  }

  function controllerLost(index) {
    if (!built) build();
    lost[index] = true;
    notice();
  }

  function controllerFound(index) {
    delete lost[index];
    notice();
  }

  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) return;
    close(true);
  });

  return {
    open: openMenu,
    close: close,
    toggle: toggle,
    hide: hide,
    busy: busyState,
    failed: failed,
    refresh: refresh,
    controllerLost: controllerLost,
    controllerFound: controllerFound,
    release: function() { setSuppressed(0); },
    isOpen: function() { return open; },
    config: function() { return config; },
    configure: configure
  };
})();

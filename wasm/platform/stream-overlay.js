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
  var built = false, open = false, closing = false, busy = false, confirm = false, shortcutsOpen = false, textOpen = false;
  var maskState = 0;
  var root = null, title = null, status = null, list = null, hint = null, confirmBox = null;
  var confirmText = null, shortcutBox = null, shortcutTitle = null, shortcutBack = null;
  var textBox = null, textInput = null, textTitle = null, textHint = null, textSend = null, textBack = null;
  var actionButtons = [], actionLabels = [], actionMetas = [], confirmButtons = [], shortcutButtons = [];
  var frameHandle = 0, releaseTimer = 0, nextRefresh = 0, lastToggleAt = 0;
  var resumeFocus = false;
  var pads = Object.create(null);
  var muteState = null;
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

  function mutedNow() {
    if (muteState !== null) return muteState;
    var control = volumeApi();
    try {
      if (control && typeof control.getMute === 'function') return !!control.getMute();
    } catch (e) {}
    return false;
  }

  function volumeLabel() {
    var control = volumeApi();
    if (!control) return translate('Volume: unavailable');
    try {
      if (mutedNow()) return translate('Volume: muted');
      if (typeof control.getVolume === 'function') {
        var level = Number(control.getVolume());
        if (isFinite(level)) return translate('Volume: ' + Math.round(level) + '%');
      }
    } catch (e) {}
    return translate('Volume');
  }

  function statsOn() {
    return typeof SessionDiagnostics !== 'undefined' && SessionDiagnostics.isVisible();
  }

  function statsLabel() {
    return translate(statsOn() ? 'Statistics: On' : typeof SessionDiagnostics !== 'undefined' && SessionDiagnostics.isRecording() ? 'Statistics: hidden · recording' : 'Statistics: Off');
  }

  function adjustVolume(delta) {
    var control = volumeApi();
    if (!control || !delta) return;
    try {
      if (mutedNow() && typeof control.setMute === 'function') {
        control.setMute(false);
        muteState = false;
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
    if (!control || typeof control.setMute !== 'function') return;
    var next = !mutedNow();
    try {
      control.setMute(next);
      // Some TV firmware reports the old mute state right after setMute.
      // Keep the requested state so the next Confirm can always reverse it.
      muteState = next;
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
    var all = [
      {id: 'resume', icon: 'play_arrow', label: function() { return translate('Resume'); },
       meta: 'Back to the game', primary: true,
       run: function() { close(); }},
      {id: 'volume', icon: 'volume_up', label: volumeLabel, meta: 'Left/Right adjusts',
       adjust: function(delta) { adjustVolume(delta); },
       run: toggleMute},
      {id: 'stats', icon: 'bar_chart', label: statsLabel, meta: 'Only on this TV · History in Settings → Diagnosis',
       run: toggleStats},
      {id: 'shortcuts', icon: 'keyboard', label: function() { return translate('Shortcuts'); },
       meta: 'Keys sent to the PC', run: openShortcuts},
      {id: 'text', icon: 'edit', label: function() { return translate('Type text'); },
       meta: 'Typed on the TV, sent to the PC', run: openText},
      {id: 'disconnect', icon: 'link_off', label: function() { return translate('Disconnect'); },
       meta: busy ? 'Closing on the PC may continue.' : 'Keeps the game on the PC',
       run: function() {
         if (typeof StreamSession === 'undefined' || !StreamSession.disconnect()) {
           failed('Could not stop the stream.');
         }
       }},
      {id: 'end', icon: 'power_settings_new', label: function() { return translate('End game on PC'); },
       meta: 'Closes the game on the PC', danger: true,
       run: askEndGame}
    ];
    return all.filter(function(item) {
      if (item.id === 'shortcuts') return typeof StreamShortcuts !== 'undefined';
      if (item.id === 'text') return typeof StreamText !== 'undefined';
      return true;
    });
  }

  // Leaves every submenu and forgets typed text: the field never keeps anything.
  function resetModes() {
    confirm = false;
    shortcutsOpen = false;
    textOpen = false;
    if (confirmBox) confirmBox.hidden = true;
    if (shortcutBox) shortcutBox.hidden = true;
    if (textBox) textBox.hidden = true;
    if (textInput) textInput.value = '';
  }

  function actionIndex(id) {
    var defs = actions();
    for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return i;
    return 0;
  }

  function build() {
    if (built) return;
    root = create('div', 'streamOverlay');
    root.hidden = true;
    var panel = create('div', 'streamOverlayPanel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'streamOverlayTitle');
    var header = create('div', 'streamOverlayHeader', 'streamOverlayHeader');
    var heading = create('div', 'streamOverlayHeading', 'streamOverlayHeading');
    heading.appendChild(create('span', 'streamOverlayEyebrow', 'streamOverlayEyebrow', 'VIBELIGHT'));
    title = create('h3', 'streamOverlayTitle', 'streamOverlayTitle');
    heading.appendChild(title);
    var guide = create('div', 'streamOverlayGuide', 'streamOverlayGuide');
    var guideIcon = create('i', null, 'material-icons', 'sports_esports');
    guideIcon.setAttribute('aria-hidden', 'true');
    guide.appendChild(guideIcon);
    guide.appendChild(create('span', null, null, translate('Guide closes')));
    header.appendChild(heading);
    header.appendChild(guide);
    status = create('div', 'streamOverlayStatus', 'streamOverlayStatus');
    status.setAttribute('aria-live', 'polite');
    list = create('div', 'streamOverlayActions', 'streamOverlayActions');
    hint = create('p', 'streamOverlayHint', 'streamOverlayHint');
    var defs = actions();
    actionButtons = [];
    actionLabels = [];
    actionMetas = [];
    for (var i = 0; i < defs.length; i++) {
      var classes = 'console-button streamOverlayAction';
      if (defs[i].primary) classes += ' streamOverlayPrimary';
      if (defs[i].danger) classes += ' streamOverlayDanger';
      var button = create('button', 'streamOverlay-' + defs[i].id, classes);
      button.setAttribute('type', 'button');
      button.setAttribute('data-action', defs[i].id);
      var iconWrap = create('span', null, 'streamOverlayIcon');
      var icon = create('i', null, 'material-icons', defs[i].icon);
      icon.setAttribute('aria-hidden', 'true');
      iconWrap.appendChild(icon);
      var copy = create('span', null, 'streamOverlayCopy');
      var label = create('span', 'streamOverlay-' + defs[i].id + '-label', 'streamOverlayLabel');
      var meta = create('span', 'streamOverlay-' + defs[i].id + '-meta', 'streamOverlayMeta',
        translate(defs[i].meta));
      copy.appendChild(label);
      copy.appendChild(meta);
      button.appendChild(iconWrap);
      button.appendChild(copy);
      list.appendChild(button);
      actionButtons.push(button);
      actionLabels.push(label);
      actionMetas.push(meta);
    }
    confirmBox = create('div', 'streamOverlayConfirm', 'streamOverlayConfirm');
    confirmBox.hidden = true;
    confirmText = create('p', 'streamOverlayConfirmText', 'streamOverlayConfirmText');
    var confirmActions = create('div', 'streamOverlayConfirmActions', 'streamOverlayConfirmActions');
    confirmButtons = [];
    ['Yes', 'No'].forEach(function(label) {
      var button = create('button', 'streamOverlayConfirm' + label,
        'console-button streamOverlayConfirmButton');
      button.setAttribute('type', 'button');
      button.textContent = label;
      confirmActions.appendChild(button);
      confirmButtons.push(button);
    });
    confirmBox.appendChild(confirmText);
    confirmBox.appendChild(confirmActions);
    shortcutBox = create('div', 'streamOverlayShortcuts', 'streamOverlayShortcuts');
    shortcutBox.hidden = true;
    shortcutTitle = create('p', 'streamOverlayShortcutTitle', 'streamOverlayShortcutTitle');
    var shortcutGrid = create('div', 'streamOverlayShortcutGrid', 'streamOverlayShortcutGrid');
    shortcutButtons = [];
    if (typeof StreamShortcuts !== 'undefined') {
      StreamShortcuts.list().forEach(function(item) {
        var button = create('button', 'streamOverlayShortcut-' + item.id, 'console-button streamOverlayShortcutButton', item.label);
        button.setAttribute('type', 'button');
        button.setAttribute('data-shortcut', item.id);
        shortcutGrid.appendChild(button);
        shortcutButtons.push(button);
      });
    }
    shortcutBack = create('button', 'streamOverlayShortcutBack', 'console-button streamOverlayShortcutButton streamOverlayShortcutBack');
    shortcutBack.setAttribute('type', 'button');
    shortcutBox.appendChild(shortcutTitle);
    shortcutBox.appendChild(shortcutGrid);
    shortcutBox.appendChild(shortcutBack);
    textBox = create('div', 'streamOverlayText', 'streamOverlayText');
    textBox.hidden = true;
    textTitle = create('p', 'streamOverlayTextTitle', 'streamOverlayTextTitle');
    textInput = create('input', 'streamOverlayTextInput', 'streamOverlayTextInput');
    textInput.setAttribute('type', 'text');
    textInput.setAttribute('maxlength', String(typeof StreamText !== 'undefined' ? StreamText.MAX_CHARACTERS : 256));
    textInput.setAttribute('autocomplete', 'off');
    textInput.setAttribute('spellcheck', 'false');
    textInput.setAttribute('autocapitalize', 'off');
    textHint = create('p', 'streamOverlayTextHint', 'streamOverlayTextHint');
    var textActions = create('div', 'streamOverlayTextActions', 'streamOverlayTextActions');
    textSend = create('button', 'streamOverlayTextSend', 'console-button streamOverlayTextButton');
    textBack = create('button', 'streamOverlayTextBack', 'console-button streamOverlayTextButton');
    textSend.setAttribute('type', 'button');
    textBack.setAttribute('type', 'button');
    textActions.appendChild(textSend);
    textActions.appendChild(textBack);
    textBox.appendChild(textTitle);
    textBox.appendChild(textInput);
    textBox.appendChild(textHint);
    textBox.appendChild(textActions);
    panel.appendChild(header);
    panel.appendChild(status);
    panel.appendChild(list);
    panel.appendChild(hint);
    panel.appendChild(confirmBox);
    panel.appendChild(shortcutBox);
    panel.appendChild(textBox);
    root.appendChild(panel);
    document.body.appendChild(root);
    built = true;
  }

  function refresh() {
    if (!built || (!open && !closing)) return;
    setText(title, translate('Stream menu'));
    setText(status, busy ? translate('Ending the game on the PC...') : translate(errorText));
    setText(hint, translate('Volume: Left/Right adjusts; Confirm toggles mute.'));
    if (hint) hint.hidden = confirm || shortcutsOpen || textOpen;
    var defs = actions();
    for (var i = 0; i < defs.length && i < actionButtons.length; i++) {
      var label = defs[i].label();
      setText(actionLabels[i], label);
      setText(actionMetas[i], translate(defs[i].meta));
      if (actionButtons[i]) {
        actionButtons[i].disabled = busy && defs[i].id !== 'disconnect';
        actionButtons[i].setAttribute('aria-label',
          label + (defs[i].meta ? '. ' + translate(defs[i].meta) : ''));
      }
    }
    setText(confirmText, translate('End the game on the PC?') + ' ' +
      translate('The running game will be closed. Unsaved progress may be lost.'));
    setText(confirmButtons[0], translate('Yes'));
    setText(confirmButtons[1], translate('No'));
    setText(shortcutTitle, translate('Send a shortcut to the PC'));
    setText(shortcutBack, translate('Back'));
    setText(textTitle, translate('Type text for the PC'));
    setText(textHint, translate('Press OK on the field to open the keyboard.'));
    setText(textSend, translate('Send'));
    setText(textBack, translate('Back'));
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
  }

  function openMenu() {
    if (open || closing) return false;
    if (typeof isInGame !== 'undefined' && !isInGame) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    if (typeof StreamSession !== 'undefined' && StreamSession.isPending() &&
        !StreamSession.isEndingHostGame()) return false;
    config = loadConfig();
    build();
    muteState = null;
    errorText = '';
    busy = false;
    resetModes();
    root.hidden = false;
    list.hidden = false;
    open = true;
    pads = Object.create(null);
    resumeFocus = false;
    setSuppressed(1);
    refresh();
    FocusManager.open(actionButtons, 0);
    if (typeof StreamSession !== 'undefined' && StreamSession.isEndingHostGame()) busyState(true);
    nextRefresh = 0;
    startFrames();
    return true;
  }

  // hide() removes the panel but keeps the native mask while the stream stops.
  function hide() {
    if (typeof StreamShortcuts !== 'undefined') StreamShortcuts.cancel();
    if (!open) return;
    open = false;
    busy = false;
    errorText = '';
    root.hidden = true;
    resetModes();
    FocusManager.close();
    stopFrames();
  }

  function close(force) {
    if (force) {
      if (typeof StreamShortcuts !== 'undefined') StreamShortcuts.cancel();
      if (!built) return true;
      open = false;
      busy = false;
      errorText = '';
      resumeFocus = false;
      root.hidden = true;
      resetModes();
      FocusManager.close();
      finishClose();
      return true;
    }
    if (!open) return false;
    // Hide the panel now, but keep the native mask until every gesture that
    // closed it is released. Otherwise the same button becomes a fresh host
    // press on resume.
    open = false;
    busy = false;
    errorText = '';
    root.hidden = true;
    resetModes();
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
    if (open) {
      resetModes();
      list.hidden = false;
      FocusManager.open(busy ? [actionButtons[actionIndex('disconnect')]] : actionButtons, busy ? 0 : actionIndex('end'));
    }
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
    // Default to No: a stray accept must not close the game on the PC.
    FocusManager.open(confirmButtons, 1);
    refresh();
  }

  function cancelConfirm() {
    confirm = false;
    confirmBox.hidden = true;
    list.hidden = false;
    FocusManager.open(actionButtons, actionIndex('end'));
    refresh();
  }

  function openShortcuts() {
    if (busy || !shortcutButtons.length) return;
    shortcutsOpen = true;
    errorText = '';
    list.hidden = true;
    shortcutBox.hidden = false;
    FocusManager.open(shortcutButtons.concat([shortcutBack]), 0);
    refresh();
  }

  function closeShortcuts() {
    shortcutsOpen = false;
    shortcutBox.hidden = true;
    list.hidden = false;
    FocusManager.open(actionButtons, actionIndex('shortcuts'));
    refresh();
  }

  function openText() {
    if (busy || !textInput) return;
    textOpen = true;
    errorText = '';
    textInput.value = '';
    list.hidden = true;
    textBox.hidden = false;
    FocusManager.open([textInput, textSend, textBack], 0);
    refresh();
  }

  function closeText() {
    textOpen = false;
    textInput.value = '';
    textBox.hidden = true;
    list.hidden = false;
    FocusManager.open(actionButtons, actionIndex('text'));
    refresh();
  }

  function sendText() {
    var result = StreamText.send(textInput.value);
    if (result.ok) {
      textInput.value = '';
      close();         // back to the game; the text is on its way
      return;
    }
    errorText = result.reason === 'empty' ? 'Type some text first.' :
      result.reason === 'too-long' ? 'The text is too long.' : 'Could not send the text.';
    refresh();
  }

  function accept() {
    if (busy) {
      if (typeof StreamSession !== 'undefined') StreamSession.disconnect();
      return;
    }
    if (textOpen) {
      var field = FocusManager.index();
      if (field === 0) {
        // The same way the other dialogs open the TV keyboard.
        textInput.focus();
        if (typeof textInput.click === 'function') textInput.click();
      } else if (field === 1) sendText();
      else closeText();
      return;
    }
    if (shortcutsOpen) {
      var picked = FocusManager.index();
      if (picked >= shortcutButtons.length) { closeShortcuts(); return; }
      if (StreamShortcuts.send(shortcutButtons[picked].getAttribute('data-shortcut'))) {
        close();       // back to the game so the shortcut is seen at once
      } else {
        closeShortcuts();
        errorText = 'Could not send the shortcut.';
        refresh();
      }
      return;
    }
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
    if (busy) { close(); return; }
    if (confirm) { cancelConfirm(); return; }
    if (shortcutsOpen) { closeShortcuts(); return; }
    if (textOpen) { closeText(); return; }
    close();
  }

  // The shortcuts form a grid (two columns, see #streamOverlayShortcutGrid) with Back below it:
  // up and down move one row and keep the column; Back remembers the column it was reached from.
  var SHORTCUT_COLUMNS = 2, shortcutColumn = 0;
  function stepShortcutRow(down) {
    var count = shortcutButtons.length, current = FocusManager.index();
    if (!count) return;
    if (current < count) shortcutColumn = current % SHORTCUT_COLUMNS;
    var rows = Math.ceil(count / SHORTCUT_COLUMNS), target;
    if (current >= count) {            // on Back
      target = down ? shortcutColumn : (rows - 1) * SHORTCUT_COLUMNS + shortcutColumn;
    } else {
      var row = Math.floor(current / SHORTCUT_COLUMNS);
      if (down) target = row + 1 < rows ? current + SHORTCUT_COLUMNS : count;
      else target = row > 0 ? current - SHORTCUT_COLUMNS : count;
    }
    if (target > count) target = count - 1;    // a short last row: stay on the last shortcut
    FocusManager.select(target);
  }

  function step(direction) {
    if (busy) return;
    if (shortcutsOpen && (direction === 'up' || direction === 'down')) {
      stepShortcutRow(direction === 'down');
      return;
    }
    if (confirm || shortcutsOpen || textOpen) {
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
      if (!state || state.id !== String(pad.id || '')) {
        state = pads[pad.index] = {
          id: String(pad.id || ''),
          family: typeof ControllerIdentity !== 'undefined' ? ControllerIdentity.familyAt(pad.index) : 'unknown',
          buttons: Object.create(null), primed: false
        };
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
      var guide = state.buttons[16];
      if (guide && !previous[16]) { close(); return; }
      // All supported families report physical accept on button 0 and back on
      // button 1, including the Switch A/B order.
      var acceptIndex = 0;
      var backIndex = 1;
      if (state.buttons[backIndex] && !previous[backIndex]) { back(); return; }
      if (state.buttons[acceptIndex] && !previous[acceptIndex]) { accept(); return; }
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
    release: function() { setSuppressed(0); },
    isOpen: function() { return open; },
    config: function() { return config; },
    configure: configure
  };
})();

// Compact editor for per-PC and per-game streaming profiles. The editor model
// below is pure; the dialog exists only while it is open and does no timer,
// polling or network work. Nothing here runs during a stream.
var StreamProfileEditor = (function() {
  var BITRATE_MIN = 0.5, BITRATE_MAX = 150, FINE = 0.5, COARSE = 5;
  var HOLD_GAP_MS = 400, HOLD_FAST_MS = 1000;
  var RESOLUTION_TEXT = {'854:480': '480p', '1280:720': '720p', '1920:1080': '1080p', '2560:1440': '1440p', '3840:2160': '4K'};
  var CODEC_TEXT = {H264: 'H.264', HEVC: 'HEVC', AV1: 'AV1'};
  var AUDIO_TEXT = {Stereo: 'Stereo', '51Surround': '5.1 Surround Sound', '71Surround': '7.1 Surround Sound'};
  var ROWS = ['resolution', 'frameRate', 'bitrate', 'codec', 'hdr', 'audio'];
  var LABELS = {resolution: 'Resolution', frameRate: 'Frame rate', bitrate: 'Bitrate', codec: 'Codec', hdr: 'HDR', audio: 'Audio'};

  function valueText(id, value) {
    if (id === 'resolution') return RESOLUTION_TEXT[value] || String(value);
    if (id === 'frameRate') return value + ' FPS';
    if (id === 'bitrate') return value + ' Mbps';
    if (id === 'codec') return CODEC_TEXT[value] || String(value);
    if (id === 'hdr') return value ? 'On' : 'Off';
    return AUDIO_TEXT[value] || String(value);
  }

  function create(options) {
    var settings = options.settings, limits = options.limits || {}, now = options.now || function() { return Date.now(); };
    var initial = {}, draft = {};
    ROWS.forEach(function(id) {
      if (options.profile && id in options.profile) { initial[id] = options.profile[id]; draft[id] = options.profile[id]; }
    });
    var hold = {direction: 0, start: 0, last: -Infinity};

    function choices(id) {
      var list;
      if (id === 'resolution') {
        list = StreamProfiles.RESOLUTIONS.filter(function(value) {
          return typeof limits.maxWidth !== 'number' || Number(value.split(':')[0]) <= limits.maxWidth;
        });
      } else if (id === 'frameRate') list = StreamProfiles.FRAME_RATES.slice();
      else if (id === 'codec') list = StreamProfiles.CODECS.slice();
      else if (id === 'hdr') list = [true, false];
      else list = StreamProfiles.AUDIO.slice();
      return [undefined].concat(list);
    }
    function adjustBitrate(direction) {
      var time = now();
      var continuing = hold.direction === direction && time - hold.last <= HOLD_GAP_MS;
      if (!continuing) hold.start = time;
      hold.direction = direction; hold.last = time;
      var current = draft.bitrate;
      if (current === undefined) {
        if (continuing) return false; // Holding past the minimum stays on Default.
        draft.bitrate = settings.bitrate;
        return true;
      }
      var step = time - hold.start >= HOLD_FAST_MS ? COARSE : FINE;
      var next = Math.round((current + direction * step) * 2) / 2;
      if (next < BITRATE_MIN) { delete draft.bitrate; return true; }
      next = Math.min(next, BITRATE_MAX);
      if (next === current) return false;
      draft.bitrate = next;
      return true;
    }
    function adjust(id, direction) {
      if (ROWS.indexOf(id) === -1) return false;
      direction = direction < 0 ? -1 : 1;
      if (id === 'bitrate') return adjustBitrate(direction);
      var list = choices(id), index = list.indexOf(draft[id]);
      if (index === -1) index = 0;
      var next = list[(index + direction + list.length) % list.length];
      if (next === undefined) delete draft[id]; else draft[id] = next;
      return true;
    }
    function defaultText(id) {
      var value = id === 'resolution' || id === 'frameRate' || id === 'bitrate' || id === 'codec' || id === 'hdr' || id === 'audio' ? settings[id] : '';
      return valueText(id, value);
    }
    function rows() {
      return ROWS.map(function(id) {
        var isDefault = !(id in draft);
        return {id: id, label: LABELS[id], text: isDefault ? 'Default' : valueText(id, draft[id]),
          defaultText: defaultText(id), isDefault: isDefault};
      });
    }
    function profile() {
      var out = {};
      ROWS.forEach(function(id) { if (id in draft) out[id] = draft[id]; });
      return out;
    }
    // H.264 with HDR chosen explicitly can never be saved.
    function problem() { return draft.codec === 'H264' && draft.hdr === true ? 'hdr-needs-hevc-or-av1' : null; }
    // HDR from one side meeting H.264 from the other: the stream starts without HDR.
    function hint() {
      if (problem() || (!('codec' in draft) && !('hdr' in draft))) return null;
      var codec = 'codec' in draft ? draft.codec : settings.codec, hdr = 'hdr' in draft ? draft.hdr : settings.hdr;
      return hdr === true && codec === 'H264' ? 'hdr-needs-hevc-or-av1' : null;
    }
    function changed() {
      return JSON.stringify(profile()) !== JSON.stringify(initial);
    }
    return {rows: rows, adjust: adjust, profile: profile, problem: problem, hint: hint, changed: changed};
  }
  // Short texts for the fields a profile sets, in row order ("720p", "25 Mbps",
  // "HDR on"); `words` translates each token when a catalog is available.
  function describe(effective, words) {
    var say = words || function(text) { return text; };
    return ROWS.filter(function(id) { return effective.fields && effective.fields[id]; }).map(function(id) {
      var value = effective.values[id];
      return say(id === 'hdr' ? (value ? 'HDR on' : 'HDR off') : valueText(id, value));
    });
  }
  return {create: create, describe: describe, ROWS: ROWS};
})();

// The dialog is created on first use and removed from the keyboard/controller
// flow when closed. It runs no timers; values change only on input events.
var StreamProfileMenu = (function() {
  var CONTROLS = ['sp-resolution', 'sp-frameRate', 'sp-bitrate', 'sp-codec', 'sp-hdr', 'sp-audio', 'sp-save', 'sp-remove', 'sp-cancel'];
  var ROW_COUNT = 6, ACTIONS = ['sp-save', 'sp-remove', 'sp-cancel'];
  var root = null, dialog = null, editor = null, request = null, existing = false, focused = 'sp-resolution';
  // The browser clicks the focused element after the OK key was handled; once the popup closes that element
  // is the opener, so an immediate second open is that extra click and is ignored.
  var closedAt = -Infinity, REOPEN_GUARD_MS = 400;

  function el(id) { return document.getElementById(id); }
  function translate(text) {
    return typeof MenuI18n !== 'undefined' && typeof MenuI18n.text === 'function' ? MenuI18n.text(text) : text;
  }
  function make(tag, id, className, text) {
    var node = document.createElement(tag);
    if (id) node.setAttribute('id', id);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function ensure() {
    if (root) return;
    root = make('div', 'streamProfileOverlay', 'sp-overlay');
    root.style.display = 'none';
    dialog = make('dialog', 'streamProfileDialog', 'sp-dialog');
    dialog.appendChild(make('h3', 'streamProfileTitle', 'sp-title'));
    var rows = make('div', null, 'sp-rows');
    StreamProfileEditor.ROWS.forEach(function(id) {
      var button = make('button', 'sp-' + id, 'sp-row');
      button.setAttribute('type', 'button');
      button.appendChild(make('span', null, 'sp-label'));
      button.appendChild(make('span', null, 'sp-value'));
      button.appendChild(make('span', null, 'sp-default'));
      // No onclick on purpose: the TV remote clicks the focused element after the key was handled,
      // which would move the row (opening on 480p, two steps per OK). Only the view changes rows.
      rows.appendChild(button);
    });
    dialog.appendChild(rows);
    dialog.appendChild(make('p', 'sp-status', 'sp-status'));
    var actions = make('div', null, 'sp-actions');
    [['sp-save', 'Save', save], ['sp-remove', 'Remove profile', remove], ['sp-cancel', 'Cancel', cancel]].forEach(function(item) {
      var button = make('button', item[0], 'sp-action', translate(item[1]));
      button.setAttribute('type', 'button');
      button.onclick = item[2];
      actions.appendChild(button);
    });
    dialog.appendChild(actions);
    root.appendChild(dialog);
    document.body.appendChild(root);
  }
  function setStatus(text) { el('sp-status').textContent = text ? translate(text) : ''; }
  function note(code) {
    return code === 'hdr-needs-hevc-or-av1' ? 'HDR needs HEVC or AV1.' : '';
  }
  function render() {
    editor.rows().forEach(function(row) {
      var node = el('sp-' + row.id);
      node.children[0].textContent = translate(row.label);
      node.children[1].textContent = '◀ ' + translate(row.text) + ' ▶';
      node.children[2].textContent = translate('Settings') + ': ' + translate(row.defaultText);
    });
    el('sp-remove').disabled = !existing;
    var problem = editor.problem(), hint = editor.hint();
    setStatus(problem ? note(problem) : hint ? note(hint) + ' ' + translate('This stream will start without HDR.') : '');
  }
  function storedProfile() {
    var entry = StreamProfiles.get().hosts[request.uid];
    if (!entry) return null;
    if (request.scope === 'host') return entry.host || null;
    return entry.games && entry.games[String(request.appId)] || null;
  }
  function hidden() { if (document.hidden) close(); }
  function close() {
    if (!dialog || !dialog.open) return;
    document.removeEventListener('visibilitychange', hidden);
    closedAt = performance.now();
    closeUtilityDialog('streamProfileDialog');
    root.style.display = 'none';
    var opener = request && request.opener;
    editor = null;
    if (opener) focusElement(opener);
  }
  function cancel() { close(); }
  function write(profile) {
    return request.scope === 'host' ? StreamProfiles.setHost(request.uid, profile)
      : StreamProfiles.setGame(request.uid, request.appId, profile);
  }
  function save() {
    if (!editor) return;
    if (editor.problem()) { render(); return; }
    var profile = editor.profile();
    if (!editor.changed()) { close(); return; }
    if (!write(profile)) {
      setStatus('Could not save the profile. Check storage; your previous profile is unchanged.');
      return;
    }
    var empty = Object.keys(profile).length === 0;
    close();
    if (typeof snackbarLog === 'function') snackbarLog(translate(empty ? 'Profile removed.' : 'Profile saved. It applies to the next stream.'));
  }
  function remove() {
    if (!editor || !existing) return;
    if (!write({})) { setStatus('Could not save the profile. Check storage; your previous profile is unchanged.'); return; }
    close();
    if (typeof snackbarLog === 'function') snackbarLog(translate('Profile removed.'));
  }
  function focus(id) { focused = id; focusElement(id); }
  function usable(id) { var node = el(id); return node && !node.disabled; }
  function moveAction(delta) {
    var index = ACTIONS.indexOf(focused);
    for (var i = index + delta; i >= 0 && i < ACTIONS.length; i += delta) {
      if (usable(ACTIONS[i])) { focus(ACTIONS[i]); return; }
    }
  }
  var view = {
    enter: function() { focusElement(focused); }, leave: function() {},
    up: function() {
      var index = CONTROLS.indexOf(focused);
      if (index >= ROW_COUNT) focus(CONTROLS[ROW_COUNT - 1]);
      else if (index > 0) focus(CONTROLS[index - 1]);
    },
    down: function() {
      var index = CONTROLS.indexOf(focused);
      if (index < ROW_COUNT - 1) focus(CONTROLS[index + 1]);
      else if (index === ROW_COUNT - 1) focus('sp-save');
    },
    left: function() { change(-1); },
    right: function() { change(1); },
    accept: function() {
      var index = CONTROLS.indexOf(focused);
      if (index >= ROW_COUNT) { var node = el(focused); if (node && !node.disabled) node.click(); return; }
      change(1);
    },
    back: function() { cancel(); },
    press: function() {}, switch: function() { focusElement(focused); }
  };
  function change(direction) {
    if (!editor) return;
    var index = CONTROLS.indexOf(focused);
    if (index >= ROW_COUNT) { moveAction(direction); return; }
    editor.adjust(StreamProfileEditor.ROWS[index], direction);
    render();
  }
  // request: {scope: 'game'|'host', uid, appId, title, settings, limits, opener}
  function open(options) {
    if (isInGame || isDialogOpen || document.hidden) return false;
    if (performance.now() - closedAt < REOPEN_GUARD_MS) return false;
    ensure();
    request = options;
    var prefix = options.scope === 'host' ? 'PC profile' : 'Game profile';
    el('streamProfileTitle').textContent = translate(prefix) + ' — ' + options.title;
    var profile = storedProfile();
    existing = !!profile;
    editor = StreamProfileEditor.create({profile: profile, settings: options.settings, limits: options.limits,
      now: function() { return performance.now(); }});
    render();
    root.style.display = 'flex';
    openUtilityDialog('streamProfileDialog', CONTROLS, 'sp-cancel', options.opener);
    // Keep Back inside the popup so it never leaves a half-edited profile behind.
    dialog.oncancel = function(event) { if (event && event.preventDefault) event.preventDefault(); cancel(); };
    document.addEventListener('visibilitychange', hidden);
    Navigation.change(view);
    focus('sp-resolution');
    return true;
  }
  return {open: open, view: view};
})();

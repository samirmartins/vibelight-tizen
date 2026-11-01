// Menu-only interface sounds. The context is created from the first menu input
// and closed when Navigation stops, so streaming never keeps a UI audio path.
var InterfaceSounds = (function() {
  var KEY = 'vibelight.interface-sounds.v1';
  var DEFAULT_ENABLED = true;
  var MIN_INTERVAL_MS = 35;
  var active = false;
  var enabled = load();
  var context = null;
  var lastPlayedAt = -MIN_INTERVAL_MS;
  var axisState = Object.create(null);
  var TONES = {
    tick: {frequency: 880, duration: 0.018, gain: 0.16},
    confirm: {frequency: 1320, duration: 0.028, gain: 0.19},
    back: {frequency: 660, duration: 0.024, gain: 0.16}
  };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw === '0') return false;
      if (raw === '1') return true;
    } catch (e) {}
    return DEFAULT_ENABLED;
  }

  function save() {
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) {}
  }

  function now() {
    return typeof performance !== 'undefined' && performance.now
      ? performance.now() : Date.now();
  }

  function menuAvailable() {
    return active && enabled &&
      !(typeof isInGame !== 'undefined' && isInGame) &&
      !(typeof document !== 'undefined' && document.hidden) &&
      (typeof Navigation === 'undefined' ||
        typeof Navigation.isRunning !== 'function' || Navigation.isRunning());
  }

  function ensureContext() {
    if (context) return context;
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      try {
        context = new AudioCtx({sampleRate: 48000, latencyHint: 'interactive'});
      } catch (e) {
        context = new AudioCtx();
      }
    } catch (e) {
      context = null;
    }
    return context;
  }

  function tone(kind) {
    var ctx = ensureContext();
    if (!ctx || (ctx.state && ctx.state !== 'running')) return;
    var spec = TONES[kind] || TONES.tick;
    try {
      var start = ctx.currentTime;
      var oscillator = ctx.createOscillator();
      var gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(spec.frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(spec.gain, start + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.onended = function() {
        try { oscillator.disconnect(); } catch (e) {}
        try { gain.disconnect(); } catch (e) {}
      };
      oscillator.start(start);
      oscillator.stop(start + spec.duration + 0.006);
    } catch (e) {}
  }

  function play(kind) {
    if (!menuAvailable()) return;
    // Menu input includes gamepad-only navigation. Create the context on the
    // first input event; the TV test verifies the platform autoplay behavior.
    var at = now();
    if (at - lastPlayedAt < MIN_INTERVAL_MS) return;
    lastPlayedAt = at;
    var ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        var resumed = ctx.resume();
        if (resumed && typeof resumed.then === 'function') {
          resumed.then(function() {
            if (menuAvailable()) tone(kind);
          }, function() {});
        } else {
          tone(kind);
        }
      } catch (e) {}
      return;
    }
    tone(kind);
  }

  // Switch labels focus their checkbox/range input; only text entry should be
  // silent. Otherwise every switch and slider item loses its tone.
  function isTextEntry(element) {
    if (!element) return false;
    if (element.isContentEditable) return true;
    var tag = element.tagName ? String(element.tagName).toUpperCase() : '';
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    var type = element.type ? String(element.type).toLowerCase() : 'text';
    return type === 'text' || type === 'search' || type === 'email' ||
      type === 'number' || type === 'password' || type === 'tel' || type === 'url';
  }

  function onKeyDown(event) {
    if (!menuAvailable()) return;
    if (isTextEntry(document.activeElement)) return;
    var code = event.keyCode || event.which;
    var sound = null;
    if (code === 13) {
      if (!event.repeat) sound = 'confirm';
    } else if (code === 27 || code === 10009 || code === 461) {
      if (!event.repeat) sound = 'back';
    } else if (code === 37 || code === 38 || code === 39 || code === 40) {
      sound = 'tick';
    }
    if (sound) play(sound);
  }

  function onGamepadChanged(event) {
    if (!menuAvailable() || !event || !event.detail) return;
    var detail = event.detail;
    var changes = detail.changes || [];
    var pad = detail.padIndex === undefined ? 0 : detail.padIndex;
    var sound = null;
    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      if (change.type === 'button') {
        if (!change.pressed) continue;
        if (change.index === 0) sound = 'confirm';
        else if (change.index === 1) sound = 'back';
        else sound = sound || 'tick';
      } else if (change.type === 'axis' && change.index >= 0 && change.index <= 3) {
        var key = pad + ':' + change.index;
        var value = Number(change.value);
        value = isFinite(value) ? Math.abs(value) : 0;
        if (value >= 0.6 && !axisState[key]) {
          axisState[key] = true;
          sound = sound || 'tick';
        } else if (value < 0.35) {
          axisState[key] = false;
        }
      }
    }
    if (sound) play(sound);
  }

  function syncSwitch() {
    var input = document.getElementById('interfaceSoundsSwitch');
    if (!input) return;
    input.checked = enabled;
    var button = document.getElementById('interfaceSoundsBtn');
    if (button && button.MaterialSwitch) {
      if (enabled) button.MaterialSwitch.on();
      else button.MaterialSwitch.off();
    }
  }

  function onSwitchChanged() {
    var input = document.getElementById('interfaceSoundsSwitch');
    if (input) setEnabled(!!input.checked);
  }

  function setEnabled(value) {
    enabled = !!value;
    save();
    syncSwitch();
    if (!enabled && context && context.state === 'running') {
      try { context.suspend(); } catch (e) {}
    }
  }

  function start() {
    active = true;
    syncSwitch();
  }

  function stop() {
    active = false;
    axisState = Object.create(null);
    if (context) {
      var closing = context;
      context = null;
      try {
        if (typeof closing.close === 'function' && closing.state !== 'closed') {
          closing.close();
        }
      } catch (e) {}
    }
  }

  function reset() {
    setEnabled(DEFAULT_ENABLED);
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('gamepadinputchanged', onGamepadChanged, true);
  document.addEventListener('DOMContentLoaded', syncSwitch);
  window.addEventListener('load', function() {
    syncSwitch();
    var input = document.getElementById('interfaceSoundsSwitch');
    if (input) input.addEventListener('change', onSwitchChanged);
    var restore = document.getElementById('continueRestoreDefaults');
    if (restore) restore.addEventListener('click', reset);
  });
  start();

  return {
    start: start,
    stop: stop,
    setEnabled: setEnabled,
    isEnabled: function() { return enabled; },
    reset: reset,
    sync: syncSwitch
  };
})();

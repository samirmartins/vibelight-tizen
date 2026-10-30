// Optional analog response for the next stream. Defaults are neutral: the
// native path still uses ClampAxis/ClampTrigger unchanged. No DOM, timer,
// frame loop or network work exists here.
var ControllerTuning = (function() {
  var key = 'moonlight.controller-tuning.v1';
  var DEADZONES = [0, 0.05, 0.1, 0.15, 0.2, 0.25];
  var CURVES = [1, 0.75, 1.5, 2];
  var THRESHOLDS = [0, 0.05, 0.1, 0.15, 0.2];

  function defaults() {
    return {version: 1, enabled: false, deadzone: 0, curve: 1,
      invertLeft: 0, invertRight: 0, swapSticks: false, triggerThreshold: 0};
  }
  function copy(config) {
    return {version: 1, enabled: !!config.enabled, deadzone: config.deadzone,
      curve: config.curve, invertLeft: config.invertLeft, invertRight: config.invertRight,
      swapSticks: !!config.swapSticks, triggerThreshold: config.triggerThreshold};
  }
  function valid(config) {
    if (!config || config.version !== 1 || typeof config.enabled !== 'boolean' ||
        typeof config.swapSticks !== 'boolean') return false;
    if (typeof config.deadzone !== 'number' || !isFinite(config.deadzone) ||
        config.deadzone < 0 || config.deadzone > 0.5) return false;
    if (typeof config.curve !== 'number' || !isFinite(config.curve) ||
        config.curve < 0.5 || config.curve > 2) return false;
    if (typeof config.triggerThreshold !== 'number' || !isFinite(config.triggerThreshold) ||
        config.triggerThreshold < 0 || config.triggerThreshold > 0.5) return false;
    var invert = [config.invertLeft, config.invertRight];
    for (var i = 0; i < invert.length; i++) {
      if (!Number.isInteger(invert[i]) || invert[i] < 0 || invert[i] > 3) return false;
    }
    return true;
  }
  var saved = defaults();
  try {
    var parsed = JSON.parse(localStorage.getItem(key));
    if (valid(parsed)) saved = copy(parsed);
  } catch (e) {} // Corrupt/unavailable storage means the original response.
  function save(config) {
    if ((typeof isInGame !== 'undefined' && isInGame) || !valid(config)) return false;
    try { localStorage.setItem(key, JSON.stringify(copy(config))); } catch (e) { return false; }
    saved = copy(config);
    return true;
  }
  // Called once before each startRequest; the input thread reads the atomic.
  function configureSession() {
    if (typeof Module === 'undefined' || typeof Module._configureGamepadTuning !== 'function') return false;
    try {
      Module._configureGamepadTuning(saved.enabled ? 1 : 0,
        Math.round(saved.deadzone * 1000), Math.round(saved.curve * 100),
        saved.invertLeft, saved.invertRight, saved.swapSticks ? 1 : 0,
        Math.round(saved.triggerThreshold * 1000));
      return true;
    } catch (e) { return false; }
  }
  return {
    defaults: defaults, valid: valid, get: function() { return copy(saved); },
    save: save, configureSession: configureSession,
    DEADZONES: DEADZONES, CURVES: CURVES, THRESHOLDS: THRESHOLDS
  };
})();

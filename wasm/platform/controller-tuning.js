// Optional per-family analog response for the next stream. Defaults are
// neutral: the native path still uses ClampAxis/ClampTrigger unchanged. No DOM,
// timer, frame loop or network work exists here.
var ControllerTuning = (function() {
  var key = 'moonlight.controller-tuning.v2';
  var legacyKey = 'moonlight.controller-tuning.v1';
  var families = ['xbox', 'playstation', 'nintendo'];
  var DEADZONES = [0, 0.05, 0.1, 0.15, 0.2, 0.25];
  var CURVES = [1, 0.75, 1.5, 2];
  var THRESHOLDS = [0, 0.05, 0.1, 0.15, 0.2, 0.25];

  function profileDefaults() {
    return {enabled: false, deadzone: 0, curve: 1,
      invertLeft: 0, invertRight: 0, swapSticks: false, triggerThreshold: 0};
  }
  function defaults() {
    var profiles = {};
    families.forEach(function(family) { profiles[family] = profileDefaults(); });
    return {version: 2, profiles: profiles};
  }
  function copyProfile(config) {
    return {enabled: !!config.enabled, deadzone: config.deadzone,
      curve: config.curve, invertLeft: config.invertLeft, invertRight: config.invertRight,
      swapSticks: !!config.swapSticks, triggerThreshold: config.triggerThreshold};
  }
  function copy(config) {
    var profiles = {};
    families.forEach(function(family) {
      profiles[family] = copyProfile(config.profiles[family]);
    });
    return {version: 2, profiles: profiles};
  }
  function validProfile(config) {
    if (!config || typeof config.enabled !== 'boolean' ||
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
  function valid(config) {
    if (!config || config.version !== 2 || !config.profiles ||
        typeof config.profiles !== 'object') return false;
    for (var i = 0; i < families.length; i++) {
      if (!validProfile(config.profiles[families[i]])) return false;
    }
    return true;
  }
  function migrate(legacy) {
    if (!legacy || legacy.version !== 1 || !validProfile(legacy)) return null;
    var config = defaults();
    families.forEach(function(family) { config.profiles[family] = copyProfile(legacy); });
    return config;
  }
  var saved = defaults();
  try {
    var parsed = JSON.parse(localStorage.getItem(key));
    if (valid(parsed)) saved = copy(parsed);
    else {
      var previous = JSON.parse(localStorage.getItem(legacyKey));
      var migrated = migrate(previous);
      if (migrated) saved = migrated;
    }
  } catch (e) {} // Corrupt/unavailable storage means the original response.
  function save(config) {
    if ((typeof isInGame !== 'undefined' && isInGame) || !valid(config)) return false;
    try { localStorage.setItem(key, JSON.stringify(copy(config))); } catch (e) { return false; }
    saved = copy(config);
    return true;
  }
  function get() { return copy(saved); }
  function getProfile(family) {
    return saved.profiles[family] ? copyProfile(saved.profiles[family]) : null;
  }
  function reset(config, family) {
    if (!config || !config.profiles || !config.profiles[family]) return false;
    config.profiles[family] = profileDefaults();
    return true;
  }
  // Called once before each startRequest; configure one native profile per
  // controller family. The native side selects by the reported pad type.
  function configureSession() {
    if (typeof Module === 'undefined' || typeof Module._configureGamepadTuning !== 'function') return false;
    try {
      for (var i = 0; i < families.length; i++) {
        var profile = saved.profiles[families[i]];
        Module._configureGamepadTuning(i + 1,
          profile.enabled ? 1 : 0,
          Math.round(profile.deadzone * 1000), Math.round(profile.curve * 100),
          profile.invertLeft, profile.invertRight, profile.swapSticks ? 1 : 0,
          Math.round(profile.triggerThreshold * 1000));
      }
      return true;
    } catch (e) { return false; }
  }
  return {
    defaults: defaults, profileDefaults: profileDefaults, valid: valid,
    get: get, getProfile: getProfile, save: save, reset: reset,
    configureSession: configureSession,
    DEADZONES: DEADZONES, CURVES: CURVES, THRESHOLDS: THRESHOLDS
  };
})();

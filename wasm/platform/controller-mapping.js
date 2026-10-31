// Per-family standard gamepad permutations. No menu, polling, timers or DOM
// work on load; a session plan is frozen before the stream starts.
var ControllerMapping = (function() {
  var key = 'moonlight.controller-mapping.v2';
  var legacyKey = 'moonlight.controller-mapping.v1';
  var families = ['xbox', 'playstation', 'nintendo'];
  var editable = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
  var session = null;

  function identity() {
    return Array.from({length:17}, function(_,i) { return i; });
  }
  function defaults() {
    var profiles = {};
    families.forEach(function(family) { profiles[family] = {map: identity()}; });
    return {version:2, profiles:profiles};
  }
  function validMap(map) {
    if (!Array.isArray(map) || map.length !== 17 || map[16] !== 16) return false;
    var seen = new Set();
    for (var i=0; i<17; i++) {
      var target = map[i];
      if (!Number.isInteger(target) || target < 0 || target >= 17 || seen.has(target)) return false;
      if ((i === 6 || i === 7) !== (target === 6 || target === 7)) return false;
      seen.add(target);
    }
    return true;
  }
  function valid(config) {
    if (!config || config.version !== 2 || !config.profiles || typeof config.profiles !== 'object') return false;
    for (var i=0; i<families.length; i++) {
      var profile = config.profiles[families[i]];
      if (!profile || !validMap(profile.map)) return false;
    }
    return true;
  }
  function copy(config) {
    var profiles = {};
    families.forEach(function(family) { profiles[family] = {map: config.profiles[family].map.slice()}; });
    return {version:2, profiles:profiles};
  }
  function profile(config, family) {
    if (!config || !config.profiles || !config.profiles[family]) return null;
    return config.profiles[family];
  }
  function migrate(legacy) {
    if (!legacy || legacy.version !== 1 || legacy.enabled !== true || !validMap(legacy.map)) return null;
    var config = defaults();
    families.forEach(function(family) { config.profiles[family].map = legacy.map.slice(); });
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
  } catch (e) {}
  function save(config) {
    if ((typeof isInGame !== 'undefined' && isInGame) || !valid(config)) return false;
    try { localStorage.setItem(key, JSON.stringify(copy(config))); } catch (e) { return false; }
    saved = copy(config);
    return true;
  }
  function assign(config, family, source, target) {
    var item = profile(config, family);
    if (!item || editable.indexOf(source) < 0 || editable.indexOf(target) < 0 ||
        (source === 6 || source === 7) !== (target === 6 || target === 7)) return false;
    var other = item.map.indexOf(target), previous = item.map[source];
    item.map[source] = target;
    item.map[other] = previous;
    return true;
  }
  function reset(config, family) {
    var item = profile(config, family);
    if (!item) return false;
    item.map = identity();
    return true;
  }
  function plan(config, family) {
    var item = profile(config, family);
    if (!item) return null;
    var sources = [], targets = [];
    for (var i=0; i<17; i++) {
      if (item.map[i] !== i) { sources.push(i); targets.push(item.map[i]); }
    }
    return {sources:sources, targets:targets,
      required: targets.length ? Math.max.apply(null, targets) + 1 : 0};
  }
  function prepareSession() {
    session = copy(saved);
    var custom = false;
    families.forEach(function(family) {
      var item = plan(session, family);
      if (item && item.sources.length) custom = true;
    });
    return custom;
  }
  function sessionBuilder(legacy) {
    if (!session || _gpButtonCount !== 17) return legacy;
    var plans = {
      xbox: plan(session, 'xbox'),
      playstation: plan(session, 'playstation'),
      nintendo: plan(session, 'nintendo')
    };
    if (!plans.xbox.sources.length && !plans.playstation.sources.length &&
        !plans.nintendo.sources.length) return legacy;
    return function(pads) {
      legacy(pads);
      var words = _gpNextWords, stride = _gpStride >> 2;
      for (var slot=0; slot<_gpMaxPads; slot++) {
        var offset = 1 + slot * stride;
        if (!words[offset]) continue;
        var type = _gpTypeForSlot && _gpTypeForSlot[slot];
        var item = type === 2 ? plans.playstation : type === 3 ? plans.nintendo : plans.xbox;
        if (!item.sources.length) continue;
        var analog = offset + 7 + _GP_MAX_AXES, digital = analog + _gpButtonCount;
        // Keep the existing physical disconnect/overlay shortcuts reachable.
        if (words[digital+8] && words[digital+4] && words[digital+5]) {
          var mask = 0;
          for (var b=0; b<17; b++) if (b !== 6 && b !== 7 && words[digital+b]) mask |= 1 << b;
          if (mask === ((1<<8)|(1<<9)|(1<<4)|(1<<5)) ||
              mask === ((1<<8)|(1<<4)|(1<<5)|(1<<2))) continue;
        }
        var scratch = new Int32Array(item.sources.length * 2);
        for (var j=0; j<item.sources.length; j++) {
          scratch[j*2] = words[analog+item.sources[j]];
          scratch[j*2+1] = words[digital+item.sources[j]];
        }
        for (var k=0; k<item.targets.length; k++) {
          words[analog+item.targets[k]] = scratch[k*2];
          words[digital+item.targets[k]] = scratch[k*2+1];
        }
        words[offset+2] = Math.max(words[offset+2], item.required);
      }
    };
  }
  return {
    defaults:defaults, valid:valid, validMap:validMap, get:function() { return copy(saved); },
    profile:profile, save:save, assign:assign, reset:reset,
    prepareSession:prepareSession, sessionBuilder:sessionBuilder
  };
})();

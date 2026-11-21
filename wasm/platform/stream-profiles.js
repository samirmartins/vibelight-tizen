// Optional per-PC and per-game streaming profiles. A profile overrides only the
// fields it contains; priority is game, then PC, then the global Settings. With
// no profile every value is the global one. No DOM, timer, network or frame-loop
// work exists here: values are read once, before a stream starts.
var StreamProfiles = (function() {
  var key = 'vibelight.stream-profiles.v1';
  var RESOLUTIONS = ['854:480', '1280:720', '1920:1080', '2560:1440', '3840:2160'];
  var FRAME_RATES = ['30', '60'];
  var CODECS = ['H264', 'HEVC', 'AV1'];
  var AUDIO = ['Stereo', '51Surround', '71Surround'];
  var FIELDS = ['resolution', 'frameRate', 'bitrate', 'codec', 'hdr', 'audio'];
  var MAX_HOSTS = 32, MAX_GAMES = 300;
  var BLOCKED = ['__proto__', 'constructor', 'prototype'];

  function validUid(uid) {
    return typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && BLOCKED.indexOf(uid) === -1;
  }
  function validAppId(appId) {
    return (typeof appId === 'number' && Number.isInteger(appId) && appId >= 0 && appId <= 9999999999) ||
      (typeof appId === 'string' && /^[0-9]{1,10}$/.test(appId));
  }
  function validBitrate(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0.5 && value <= 150 &&
      Math.round(value * 2) === value * 2;
  }
  function valid(profile) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
    var names = Object.keys(profile);
    for (var i = 0; i < names.length; i++) if (FIELDS.indexOf(names[i]) === -1) return false;
    if ('resolution' in profile && RESOLUTIONS.indexOf(profile.resolution) === -1) return false;
    if ('frameRate' in profile && FRAME_RATES.indexOf(profile.frameRate) === -1) return false;
    if ('bitrate' in profile && !validBitrate(profile.bitrate)) return false;
    if ('codec' in profile && CODECS.indexOf(profile.codec) === -1) return false;
    if ('hdr' in profile && typeof profile.hdr !== 'boolean') return false;
    if ('audio' in profile && AUDIO.indexOf(profile.audio) === -1) return false;
    return !(profile.codec === 'H264' && profile.hdr === true);
  }
  function copyProfile(profile) {
    var out = {};
    FIELDS.forEach(function(name) { if (name in profile) out[name] = profile[name]; });
    return out;
  }
  function isEmpty(profile) { return Object.keys(profile).length === 0; }

  // Drops invalid entries instead of discarding every profile.
  function sanitize(raw) {
    var out = {version: 1, hosts: {}};
    if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.hosts ||
        typeof raw.hosts !== 'object' || Array.isArray(raw.hosts)) return out;
    Object.keys(raw.hosts).forEach(function(uid) {
      if (!validUid(uid) || Object.keys(out.hosts).length >= MAX_HOSTS) return;
      var entry = raw.hosts[uid], clean = {};
      if (!entry || typeof entry !== 'object') return;
      if (entry.host && valid(entry.host) && !isEmpty(entry.host)) clean.host = copyProfile(entry.host);
      if (entry.games && typeof entry.games === 'object' && !Array.isArray(entry.games)) {
        var games = {}, count = 0;
        Object.keys(entry.games).forEach(function(appId) {
          var profile = entry.games[appId];
          if (!validAppId(appId) || !valid(profile) || isEmpty(profile) || count >= MAX_GAMES) return;
          games[appId] = copyProfile(profile); count++;
        });
        if (count) clean.games = games;
      }
      if (clean.host || clean.games) out.hosts[uid] = clean;
    });
    return out;
  }
  function clone(state) { return sanitize(JSON.parse(JSON.stringify(state))); }

  var state = {version: 1, hosts: {}};
  try { state = sanitize(JSON.parse(localStorage.getItem(key))); } catch (e) {} // Corrupt storage: no profiles.

  // Replaces the stored state only after the write succeeded.
  function commit(next) {
    try { localStorage.setItem(key, JSON.stringify(next)); } catch (e) { return false; }
    state = next;
    return true;
  }
  function get() { return clone(state); }
  function gameCount(entry) { return entry && entry.games ? Object.keys(entry.games).length : 0; }

  function setHost(uid, profile) {
    if (!validUid(uid) || !valid(profile)) return false;
    var next = clone(state), entry = next.hosts[uid] || {};
    if (!next.hosts[uid] && Object.keys(next.hosts).length >= MAX_HOSTS) return false;
    if (isEmpty(profile)) delete entry.host; else entry.host = copyProfile(profile);
    if (entry.host || entry.games) next.hosts[uid] = entry; else delete next.hosts[uid];
    return commit(next);
  }
  function setGame(uid, appId, profile) {
    if (!validUid(uid) || !validAppId(appId) || !valid(profile)) return false;
    var id = String(appId), next = clone(state), entry = next.hosts[uid] || {};
    if (!next.hosts[uid] && Object.keys(next.hosts).length >= MAX_HOSTS) return false;
    var games = entry.games || {};
    if (!(id in games) && !isEmpty(profile) && gameCount(entry) >= MAX_GAMES) return false;
    if (isEmpty(profile)) delete games[id]; else games[id] = copyProfile(profile);
    if (Object.keys(games).length) entry.games = games; else delete entry.games;
    if (entry.host || entry.games) next.hosts[uid] = entry; else delete next.hosts[uid];
    return commit(next);
  }
  function clearHost(uid) { return validUid(uid) ? setHost(uid, {}) : false; }
  function clearGame(uid, appId) { return validUid(uid) && validAppId(appId) ? setGame(uid, appId, {}) : false; }
  function forgetHost(uid) {
    if (!validUid(uid)) return false;
    var next = clone(state);
    delete next.hosts[uid];
    return commit(next);
  }
  function clearAll() { return commit({version: 1, hosts: {}}); }
  function count() {
    var hosts = 0, games = 0;
    Object.keys(state.hosts).forEach(function(uid) {
      if (state.hosts[uid].host) hosts++;
      games += gameCount(state.hosts[uid]);
    });
    return {hosts: hosts, games: games};
  }

  function hasGame(uid, appId) {
    return validUid(uid) && validAppId(appId) && Object.prototype.hasOwnProperty.call(state.hosts, uid) &&
      !!state.hosts[uid].games && Object.prototype.hasOwnProperty.call(state.hosts[uid].games, String(appId));
  }

  // Field-by-field merge of the PC profile and the game profile (game wins).
  function resolve(uid, appId) {
    var out = {source: 'none', fields: {}, values: {}};
    if (!validUid(uid) || !Object.prototype.hasOwnProperty.call(state.hosts, uid)) return out;
    var entry = state.hosts[uid], layers = [];
    if (entry.host) layers.push(['host', entry.host]);
    if (validAppId(appId) && entry.games && Object.prototype.hasOwnProperty.call(entry.games, String(appId)))
      layers.push(['game', entry.games[String(appId)]]);
    layers.forEach(function(layer) {
      FIELDS.forEach(function(name) {
        if (name in layer[1]) { out.values[name] = layer[1][name]; out.fields[name] = layer[0]; }
      });
      out.source = layer[0];
    });
    return out;
  }

  // The values used to start the stream. `global` holds the Settings values;
  // `limits.maxWidth` is the widest resolution the panel can show.
  function effective(uid, appId, global, limits) {
    var resolved = resolve(uid, appId), notes = [];
    var values = {}, fields = {};
    FIELDS.forEach(function(name) { values[name] = global[name]; });
    if (resolved.source === 'none') return {source: 'none', fields: {}, values: values, notes: notes};
    FIELDS.forEach(function(name) {
      if (name in resolved.values) { values[name] = resolved.values[name]; fields[name] = resolved.fields[name]; }
    });
    var maxWidth = limits && limits.maxWidth;
    if (fields.resolution && typeof maxWidth === 'number' && Number(values.resolution.split(':')[0]) > maxWidth) {
      values.resolution = global.resolution;
      delete fields.resolution;
      notes.push('resolution-over-panel-limit');
    }
    if (values.hdr === true && values.codec === 'H264') {
      values.hdr = false;
      notes.push('hdr-needs-hevc-or-av1');
    }
    return {source: resolved.source, fields: fields, values: values, notes: notes};
  }
  return {
    FIELDS: FIELDS, RESOLUTIONS: RESOLUTIONS, FRAME_RATES: FRAME_RATES, CODECS: CODECS, AUDIO: AUDIO,
    valid: valid, get: get, count: count, hasGame: hasGame, resolve: resolve, effective: effective,
    setHost: setHost, setGame: setGame, clearHost: clearHost, clearGame: clearGame,
    forgetHost: forgetHost, clearAll: clearAll
  };
})();

// Menu-side controller identity. Detection is name/VID based and cached; the
// module never reads or logs a full controller id outside this file. No timer,
// frame loop or network work exists here.
var ControllerIdentity = (function() {
  var cache = Object.create(null);
  var FAMILIES = ['xbox', 'playstation', 'nintendo'];

  function detect(value) {
    var id = String(value || '').toLowerCase();
    var vendor = id.match(/\bvendor\s*:\s*(?:0x)?([0-9a-f]{4})\b/) ||
      id.match(/^([0-9a-f]{4})[-:]([0-9a-f]{4})(?:[-:\s]|$)/) ||
      id.match(/\bvid_([0-9a-f]{4})(?:&|\b)/);
    if (vendor) {
      if (vendor[1] === '054c') return 'playstation';
      if (vendor[1] === '045e') return 'xbox';
      if (vendor[1] === '057e') return 'nintendo';
    }
    if (/playstation|dualsense|dualshock|sony/.test(id)) return 'playstation';
    if (/xbox|xinput|x-box|microsoft|360/.test(id)) return 'xbox';
    if (/nintendo|switch|joy-con|pro controller/.test(id)) return 'nintendo';
    return 'unknown';
  }

  function familyOf(gamepad) {
    if (!gamepad) return 'unknown';
    var id = String(gamepad.id || '');
    if (cache[id] === undefined) {
      // The streaming publisher already owns the canonical vendor/name rules.
      // This module only adapts its numeric type to the menu vocabulary.
      if (typeof _gpControllerType === 'function') {
        var type = _gpControllerType(gamepad);
        cache[id] = type === 1 ? 'xbox' : type === 2 ? 'playstation' : type === 3 ? 'nintendo' : 'unknown';
      } else {
        cache[id] = detect(id);
      }
    }
    return cache[id];
  }

  function padsNow() {
    try { return navigator.getGamepads ? navigator.getGamepads() : []; }
    catch (e) { return []; }
  }

  function familyAt(index) {
    var pads = padsNow();
    for (var i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected && pads[i].index === index) return familyOf(pads[i]);
    }
    return 'unknown';
  }

  function players() {
    var pads = padsNow(), list = [];
    for (var i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) list.push({index: pads[i].index, family: familyOf(pads[i])});
    }
    list.sort(function(a, b) { return a.index - b.index; });
    return list.slice(0, 4).map(function(pad, position) {
      return {player: position + 1, index: pad.index, family: pad.family};
    });
  }

  function primaryFamily() {
    var list = players();
    return list.length ? list[0].family : 'unknown';
  }

  function translate(value) {
    return typeof MenuI18n !== 'undefined' && typeof MenuI18n.text === 'function'
      ? MenuI18n.text(value) : value;
  }

  function familyName(family) {
    if (family === 'xbox') return 'Xbox';
    if (family === 'playstation') return 'PlayStation';
    if (family === 'nintendo') return 'Switch';
    return translate('Gamepad');
  }

  function labels(family) {
    family = FAMILIES.indexOf(family) !== -1 ? family : 'xbox';
    if (family === 'playstation') {
      return {accept: '✕', back: '○', face2: '□', face3: '△',
        lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2',
        select: 'Create', start: 'Options', guide: 'PS'};
    }
    if (family === 'nintendo') {
      return {accept: 'A', back: 'B', face2: 'Y', face3: 'X',
        lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR',
        select: '-', start: '+', guide: 'HOME'};
    }
    return {accept: 'A', back: 'B', face2: 'X', face3: 'Y',
      lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT',
      select: 'View', start: 'Menu', guide: 'Guide'};
  }

  function acceptButton(index) { return familyAt(index) === 'nintendo' ? 1 : 0; }
  function backButton(index) { return familyAt(index) === 'nintendo' ? 0 : 1; }

  function refreshPlayers() {
    var node = document.getElementById('controllerPlayers');
    if (!node) return;
    var list = players();
    if (!list.length || (typeof isInGame !== 'undefined' && isInGame) || document.hidden) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    var text = list.map(function(pad) {
      return translate('Controller ' + pad.player) + ' · ' + familyName(pad.family);
    }).join(' | ');
    if (node.textContent !== text) node.textContent = text;
    node.hidden = false;
  }

  function localizeGuide() {
    if (typeof document.querySelectorAll !== 'function') return;
    var family = primaryFamily(), set = labels(family);
    var nodes = document.querySelectorAll('#navGuideDialogText [data-gamepad]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-gamepad');
      if (set[key] !== undefined) nodes[i].textContent = set[key];
    }
    var familyNode = document.getElementById('navGuideFamily');
    if (familyNode) {
      familyNode.textContent = family === 'unknown' ? '' : '(' + familyName(family) + ')';
    }
  }

  window.addEventListener('gamepadconnected', refreshPlayers);
  window.addEventListener('gamepaddisconnected', refreshPlayers);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) refreshPlayers();
  });
  refreshPlayers();

  return {
    detect: detect,
    familyOf: familyOf,
    familyAt: familyAt,
    players: players,
    primaryFamily: primaryFamily,
    familyName: familyName,
    labels: labels,
    acceptButton: acceptButton,
    backButton: backButton,
    refreshPlayers: refreshPlayers,
    localizeGuide: localizeGuide
  };
})();

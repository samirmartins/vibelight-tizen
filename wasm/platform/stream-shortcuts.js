// Keyboard shortcuts sent to the PC from the stream menu. Keys are pressed in
// order, held for a short moment so the PC registers them and released in
// reverse order, as a real keyboard would. A timer exists only while a
// shortcut is being held; nothing runs at load or during normal play.
var StreamShortcuts = (function() {
  var KEY_DOWN = 0x03, KEY_UP = 0x04, MODIFIER_ALT = 0x04, HOLD_MS = 40;
  var ALT = 18, TAB = 9, ENTER = 13, ESC = 27, WIN = 91, D = 68;   // browser/Windows key codes
  var LIST = [
    {id: 'esc', label: 'Esc', keys: [ESC]},
    {id: 'alt-tab', label: 'Alt+Tab', keys: [ALT, TAB]},
    {id: 'win', label: 'Win', keys: [WIN]},
    {id: 'win-d', label: 'Win+D', keys: [WIN, D]},
    {id: 'alt-enter', label: 'Alt+Enter', keys: [ALT, ENTER]},
    {id: 'enter', label: 'Enter', keys: [ENTER]}
  ];
  var pending = null, timer = 0;

  function find(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }
  // The flag a real keyboard reports: Alt marks the keys pressed while it is held,
  // and its own key-up no longer carries it.
  function flags(held) { return held.indexOf(ALT) !== -1 ? MODIFIER_ALT : 0; }

  // Releases in reverse order; every key is attempted even if one call fails.
  function releaseAll() {
    if (!pending) return;
    var held = pending.held.slice();
    pending = null;
    while (held.length) {
      var code = held.pop();
      try { Module.sendKeyboardEvent(code, KEY_UP, flags(held)); } catch (e) {}
    }
  }
  function finish() { timer = 0; releaseAll(); }

  function send(id) {
    var shortcut = typeof id === 'string' ? find(id) : null;
    if (!shortcut || pending) return false;
    if (typeof isInGame === 'undefined' || !isInGame) return false;
    if (typeof Module === 'undefined' || !Module || typeof Module.sendKeyboardEvent !== 'function') return false;
    pending = {held: []};
    for (var i = 0; i < shortcut.keys.length; i++) {
      pending.held.push(shortcut.keys[i]);
      try {
        Module.sendKeyboardEvent(shortcut.keys[i], KEY_DOWN, flags(pending.held));
      } catch (e) {
        pending.held.pop();           // this key never went down
        releaseAll();
        return false;
      }
    }
    timer = setTimeout(finish, HOLD_MS);
    return true;
  }
  // Called when the stream stops or the app is hidden: release the keys now.
  function cancel() {
    if (!pending) return false;
    if (timer) { clearTimeout(timer); timer = 0; }
    releaseAll();
    return true;
  }
  function list() { return LIST.map(function(item) { return {id: item.id, label: item.label}; }); }
  return {list: list, send: send, cancel: cancel, busy: function() { return !!pending; }};
})();

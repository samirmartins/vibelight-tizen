'use strict';
// The Shortcuts entry of the stream menu: submenu, controller navigation, sending
// a shortcut and closing the menu, and the cancel paths. Real overlay and focus code.
const assert = require('assert');
const {fixture} = require('./fixtures/stream-overlay.cjs');
const DOWN = 3, UP = 4, ALT = 4;
const ids = ['esc', 'alt-tab', 'win', 'win-d', 'alt-enter', 'enter'];

function opened(options = {}) {
  const f = fixture(options), keys = [];
  f.c.Module.sendKeyboardEvent = (code, action, modifiers) => {
    if (options.failSend) throw Error('native failure');
    keys.push([code, action, modifiers]);
  };
  f.setPad({});
  assert.strictEqual(f.c.StreamOverlay.open(), true);
  f.step();   // prime the pad
  const hold = () => [...f.timers.values()].find(timer => timer.ms === 40);
  const node = id => f.document.getElementById(id);
  const shortcutsIndex = () => ['resume', 'volume', 'stats', 'shortcuts', 'disconnect', 'end'].indexOf('shortcuts');
  const select = index => f.c.FocusManager.select(index);
  return {f, keys, hold, node, select, shortcutsIndex};
}

// The menu lists Shortcuts after Statistics and before the session actions.
{
  const {f, node} = opened();
  assert.strictEqual(f.text('streamOverlay-shortcuts-label'), 'Atalhos', 'bundled pt-BR label');
  assert.strictEqual(f.text('streamOverlay-shortcuts-meta'), 'Teclas enviadas ao PC');
  const order = ['resume', 'volume', 'stats', 'shortcuts', 'disconnect', 'end'];
  assert.deepStrictEqual(order.map(id => !!node('streamOverlay-' + id)), order.map(() => true));
  assert.strictEqual(node('streamOverlay-shortcuts').getAttribute('data-action'), 'shortcuts');
}

// Opening the submenu hides the list and focuses the first shortcut; Back returns to the entry.
{
  const t = opened();
  const {f, node} = t;
  t.select(t.shortcutsIndex());
  f.press({0: true}); f.release();
  assert.strictEqual(node('streamOverlayActions').hidden, true);
  assert.strictEqual(node('streamOverlayShortcuts').hidden, false);
  assert.deepStrictEqual(ids.map(id => !!node('streamOverlayShortcut-' + id)), ids.map(() => true));
  assert.strictEqual(f.c.FocusManager.index(), 0);
  assert.strictEqual(f.text('streamOverlayShortcutTitle'), 'Enviar um atalho ao PC');
  assert.strictEqual(f.text('streamOverlayShortcut-alt-tab'), 'Alt+Tab');
  assert.strictEqual(f.text('streamOverlayShortcutBack'), 'Voltar');
  // Down and right move forward, up and left backward, ending on Back.
  for (let i = 0; i < 6; i++) { f.press({13: true}); f.release(); }
  assert.strictEqual(f.c.FocusManager.index(), 6, 'Back is the last item');
  f.press({12: true}); f.release();
  assert.strictEqual(f.c.FocusManager.index(), 5);
  f.press({15: true}); f.release();
  assert.strictEqual(f.c.FocusManager.index(), 6);
  // B/Back and the Back button return to the entry on the list.
  f.press({1: true}); f.release();
  assert.strictEqual(node('streamOverlayActions').hidden, false);
  assert.strictEqual(node('streamOverlayShortcuts').hidden, true);
  assert.strictEqual(f.c.FocusManager.index(), t.shortcutsIndex());
  assert(f.c.StreamOverlay.isOpen(), 'Back from the submenu does not close the menu');
}

// Sending a shortcut presses the keys, closes the menu and releases the keys after the hold.
{
  const t = opened();
  const {f, keys} = t;
  t.select(t.shortcutsIndex());
  f.press({0: true}); f.release();
  for (let i = 0; i < 3; i++) { f.press({13: true}); f.release(); }   // Win+D
  assert.strictEqual(f.c.FocusManager.index(), 3);
  f.press({0: true}); f.release();
  assert.deepStrictEqual(keys, [[91, DOWN, 0], [68, DOWN, 0]]);
  assert.strictEqual(f.c.StreamOverlay.isOpen(), false, 'the menu closes so the shortcut is seen');
  assert.strictEqual(t.hold().ms, 40);
  t.hold().handler();
  assert.deepStrictEqual(keys, [[91, DOWN, 0], [68, DOWN, 0], [68, UP, 0], [91, UP, 0]]);
  assert.strictEqual(f.c.StreamShortcuts.busy(), false);
}

// The native mask and the stream stay as before: the shortcut goes through the keyboard path only.
{
  const t = opened();
  const {f, keys} = t;
  assert.deepStrictEqual(f.calls.suppressed, [1]);
  t.select(t.shortcutsIndex());
  f.press({0: true}); f.release();
  f.press({0: true}); f.release();           // Esc
  assert.deepStrictEqual(keys, [[27, DOWN, 0]]);
  assert.strictEqual(f.calls.stop, 0);
  assert.strictEqual(f.calls.quit, 0);
}

// A native failure comes back to the list with a message and no key left pressed.
{
  const t = opened({failSend: true});
  const {f, node, keys} = t;
  t.select(t.shortcutsIndex());
  f.press({0: true}); f.release();
  f.press({0: true}); f.release();
  assert.deepStrictEqual(keys, []);
  assert.strictEqual(node('streamOverlayActions').hidden, false);
  assert.strictEqual(node('streamOverlayShortcuts').hidden, true);
  assert.strictEqual(f.text('streamOverlayStatus'), 'Não foi possível enviar o atalho.');
  assert(f.c.StreamOverlay.isOpen());
}

// Hiding the app or stopping the stream while a shortcut is held releases the keys immediately.
for (const leave of ['force', 'hide', 'visibility']) {
  const t = opened();
  const {f, keys} = t;
  t.select(t.shortcutsIndex());
  f.press({0: true}); f.release();
  for (let i = 0; i < 1; i++) { f.press({13: true}); f.release(); }   // Alt+Tab
  f.press({0: true}); f.release();
  assert.deepStrictEqual(keys, [[18, DOWN, ALT], [9, DOWN, ALT]]);
  if (leave === 'force') f.c.StreamOverlay.close(true);
  else if (leave === 'hide') f.c.StreamOverlay.hide();
  else { f.document.hidden = true; for (const handler of f.listeners.visibilitychange || []) handler(); }
  assert.deepStrictEqual(keys.slice(2), [[9, UP, ALT], [18, UP, 0]], leave + ': keys released now');
  assert.strictEqual(t.hold(), undefined, leave + ': no timer left');
}

// The submenu is not shown over a busy menu and a closed menu starts on the list.
{
  const t = opened();
  const {f, node} = t;
  t.select(t.shortcutsIndex());
  f.press({0: true}); f.release();
  f.c.StreamOverlay.busy(true);
  assert.strictEqual(node('streamOverlayShortcuts').hidden, true);
  assert.strictEqual(node('streamOverlayActions').hidden, false);
  f.c.StreamOverlay.close(true);
  assert.strictEqual(f.c.StreamOverlay.open(), true);
  assert.strictEqual(node('streamOverlayShortcuts').hidden, true);
  assert.strictEqual(node('streamOverlayActions').hidden, false);
}

// Disconnect and End game keep their behavior at their new positions.
{
  const t = opened();
  const {f, node} = t;
  assert.strictEqual(f.text('streamOverlay-disconnect-label'), 'Desconectar');
  assert.strictEqual(f.text('streamOverlay-end-label'), 'Encerrar jogo no PC');
  t.select(5);                                // End game on the PC
  f.press({0: true}); f.release();
  assert.strictEqual(node('streamOverlayConfirm').hidden, false);
  assert.strictEqual(f.c.FocusManager.index(), 1, 'the confirmation defaults to No');
  f.press({0: true}); f.release();            // No
  assert.strictEqual(f.c.FocusManager.index(), 5, 'cancelling returns to End game');
}
console.log('stream_overlay_shortcuts_test: menu entry, submenu navigation, send and close, native failure, release on hide/stop, busy state and unchanged session actions PASS');

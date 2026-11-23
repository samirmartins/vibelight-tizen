'use strict';
// Confirmation dialogs that delete or discard something (delete host, delete all hosts and
// profiles, quit the running game, restore defaults) always open with Cancel focused, whatever
// the previous choice was. Left still reaches Continue, Right returns to Cancel.
const assert = require('assert');
const {load} = require('./fixtures/navigation-fixture.cjs');

const dialogs = [['DeleteHostDialog', 'continueDeleteHost', 'cancelDeleteHost'],
  ['QuitAppDialog', 'continueQuitApp', 'cancelQuitApp'],
  ['RestoreDefaultsDialog', 'continueRestoreDefaults', 'cancelRestoreDefaults']];
for (const [name, ok, cancel] of dialogs) {
  for (const stale of [0, 1]) {
    const f = load(), view = f.views[name];
    view.view.index = stale; // what an earlier use of the dialog left behind
    f.c.Navigation.push(view);
    f.timers.splice(0).forEach(fn => fn());
    assert.strictEqual(view.view.current(), cancel, `${name} opens on Cancel (stale index ${stale})`);
    assert.strictEqual(f.log[f.log.length - 1], 'focus:' + cancel, `${name}: Cancel has the focus`);
    assert(f.el(cancel).classList.contains('hovered'), `${name}: Cancel is marked`);
    assert(!f.el(ok).classList.contains('hovered'), `${name}: Continue is not marked`);
    view.left();
    assert.strictEqual(view.view.current(), ok, `${name}: Left reaches Continue`);
    assert.strictEqual(f.log[f.log.length - 1], 'focus:' + ok);
    view.right();
    assert.strictEqual(view.view.current(), cancel, `${name}: Right returns to Cancel`);
    // Closed and opened again after confirming: Cancel again.
    view.left(); f.c.Navigation.change(f.views.WarningDialog); f.c.Navigation.change(view);
    f.timers.splice(0).forEach(fn => fn());
    assert.strictEqual(view.view.current(), cancel, `${name}: opens on Cancel the next time too`);
  }
}
// Dialogs that are not destructive are left as they were.
{
  const f = load(), view = f.views.RestartMoonlightDialog;
  view.view.index = 0; f.c.Navigation.push(view); f.timers.splice(0).forEach(fn => fn());
  assert.strictEqual(view.view.current(), 'continueRestartApp', 'restart keeps its first button');
}
console.log('navigation_confirm_focus_test: destructive confirmations open on Cancel, others unchanged PASS');

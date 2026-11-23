'use strict';
// Dialogs with one button (pairing, host details, warning): Up and Down keep the button focused
// instead of dropping and returning the focus.
const assert = require('assert');
const {load} = require('./fixtures/navigation-fixture.cjs');

for (const [name, button] of [['PairingDialog', 'cancelPairing'], ['HostDetailsDialog', 'closeHostDetails'], ['WarningDialog', 'closeWarning']]) {
  const f = load(), view = f.views[name];
  f.el(button).focus();
  for (const key of ['up', 'down', 'up', 'down']) {
    view[key]();
    assert.strictEqual(f.c.document.activeElement, f.el(button), `${name}: ${key} keeps ${button} focused`);
  }
  assert(!f.log.some(entry => entry === 'blur:' + button));
  // Left, Right and OK are unchanged.
  view.left(); view.right();
  assert.strictEqual(f.c.document.activeElement, f.el(button));
  f.log.length = 0; view.view.index = 0; view.accept();
  assert.deepStrictEqual(f.log, ['click:' + button], `${name}: OK still presses the button`);
}
console.log('navigation_single_button_test: one-button dialogs keep their button focused PASS');

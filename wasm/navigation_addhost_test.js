'use strict';
// Add PC dialog: Down on Continue/Cancel stays put. In the numeric IP-field mode it used to jump
// to the second octet field (index 1 is only Continue in the text mode).
const assert = require('assert');
const {load} = require('./fixtures/navigation-fixture.cjs');

function dialog(fieldMode) {
  const f = load();
  f.el('ipAddressFieldModeSwitch').checked = fieldMode;
  const view = f.views.AddHostDialog;
  const at = id => { view.view.index = view.view.func().indexOf(id); assert(view.view.index >= 0, id); };
  return {f, view, at, current: () => view.view.current()};
}

// Field mode: Down on a button does nothing; Down on a field still lowers its value.
for (const button of ['continueAddHost', 'cancelAddHost']) {
  const d = dialog(true); d.at(button); d.f.log.length = 0;
  d.view.down();
  assert.strictEqual(d.current(), button, 'field mode: Down on ' + button + ' stays');
  assert.deepStrictEqual(d.f.log, [], 'no focus change');
}
{
  const d = dialog(true); d.at('ipAddressField2'); d.f.el('ipAddressField2').value = '10';
  d.view.down();
  assert.strictEqual(d.f.el('ipAddressField2').value, 9, 'Down on a field lowers it');
  assert.strictEqual(d.current(), 'ipAddressField2');
  d.view.up();
  assert.strictEqual(d.f.el('ipAddressField2').value, 10, 'Up raises it');
}
// Field mode: Up on a button still goes to the first field.
{
  const d = dialog(true); d.at('continueAddHost');
  d.view.up();
  assert.strictEqual(d.current(), 'ipAddressField1');
}
// Text mode: Down from the address box reaches Continue; Down on a button stays; Up goes back to the box.
{
  const d = dialog(false); d.at('ipAddressTextInput');
  d.view.down();
  assert.strictEqual(d.current(), 'continueAddHost');
  d.view.down();
  assert.strictEqual(d.current(), 'continueAddHost', 'text mode: Down on Continue stays');
  d.at('cancelAddHost'); d.view.down();
  assert.strictEqual(d.current(), 'cancelAddHost', 'text mode: Down on Cancel stays');
  d.view.up();
  assert.strictEqual(d.current(), 'ipAddressTextInput');
}
console.log('navigation_addhost_test: Down on Add PC buttons stays put in both address modes PASS');

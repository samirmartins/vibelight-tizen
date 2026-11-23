'use strict';
// Settings pages: Left goes back to the categories (like Back), Right does nothing. The popup
// menus with a slider keep Left/Right for the value, and typing in a text field keeps Left for
// the cursor.
const assert = require('assert');
const {load} = require('./fixtures/navigation-fixture.cjs');

const pages = ['BasicSettings', 'HostSettings', 'InputSettings', 'AudioSettings', 'VideoSettings', 'AdvancedSettings', 'AboutSettings'];
for (const name of pages) {
  const f = load(), view = f.views[name];
  let backs = 0;
  view.back = () => { backs++; };
  view.left();
  assert.strictEqual(backs, 1, name + ': Left goes back');
  view.right();
  assert.strictEqual(backs, 1, name + ': Right does nothing');
  // A text field being edited keeps Left for the cursor.
  f.c.document.activeElement = {tagName: 'INPUT', type: 'text', readOnly: false};
  view.left();
  assert.strictEqual(backs, 1, name + ': Left stays in a text field');
  // A switch (checkbox input) is not text entry.
  f.c.document.activeElement = {tagName: 'INPUT', type: 'checkbox', readOnly: false};
  view.left();
  assert.strictEqual(backs, 2, name + ': Left still goes back from a switch');
  f.c.document.activeElement = {tagName: 'BUTTON'};
  view.left();
  assert.strictEqual(backs, 3, name + ': Left goes back from a button');
}
// The slider popups and the category list keep their own Left/Right.
{
  const f = load();
  assert(/stepDown/.test(String(f.views.SelectBitrateMenu.left)), 'bitrate popup: Left lowers the value');
  assert(/stepUp/.test(String(f.views.SelectBitrateMenu.right)), 'bitrate popup: Right raises the value');
  assert(/stepDown/.test(String(f.views.SelectAudioJitterMenu.left)), 'jitter popup: Left lowers the value');
  assert(/stepUp/.test(String(f.views.SelectAudioJitterMenu.right)), 'jitter popup: Right raises the value');
}
console.log('navigation_settings_left_test: Left returns to the categories from every settings page PASS');

'use strict';
// Settings category list: Right opens the page of the focused category, like OK. (Left, inside a
// page, goes back to this list.) Left on the list itself does nothing.
const assert = require('assert');
const {load} = require('./fixtures/navigation-fixture.cjs');

const f = load();
const names = ['basicSettingsCat', 'hostSettingsCat', 'inputSettingsCat'];
const categories = names.map(name => f.el(name));
f.c.document.querySelector = selector => selector === '.settings-categories' ? {children: categories} : null;
const view = f.views.Settings;

view.view.index = 0;
f.log.length = 0; view.right();
assert.deepStrictEqual(f.log, ['click:basicSettingsCat'], 'Right opens the first category');
view.view.index = 2;
f.log.length = 0; view.right();
assert.deepStrictEqual(f.log, ['click:inputSettingsCat'], 'Right opens the focused category');
// Same as OK.
f.log.length = 0; view.accept();
assert.deepStrictEqual(f.log, ['click:inputSettingsCat'], 'OK still opens it');
// Left on the list does nothing.
f.log.length = 0; view.left();
assert.deepStrictEqual(f.log, [], 'Left on the list does nothing');
// A disabled category is not opened.
categories[1].disabled = true; view.view.index = 1;
f.log.length = 0; view.right();
assert.deepStrictEqual(f.log, [], 'a disabled category stays closed');
console.log('navigation_settings_right_test: Right opens the focused settings category PASS');

'use strict';
// The frame rate menu: 120 FPS appears (marked Experimental, like the audio options) only when the
// panel is measured near 120 Hz, a stored 120 comes back when the panel is known, and a 120 that
// the panel cannot show returns to 60. Real module on the shared mini DOM.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const {createDocument} = require('./fixtures/mini-dom.cjs');
const source = fs.readFileSync('wasm/platform/high-refresh.js', 'utf8') + '\n' + fs.readFileSync('wasm/platform/high-refresh-menu.js', 'utf8');

function page(selected = '60') {
  const document = createDocument();
  const menu = document.createElement('ul'); menu.id = 'menu';
  for (const rate of ['30', '60']) {
    const item = document.createElement('li'); item.setAttribute('data-value', rate); item.classList.add('mdl-menu__item');
    item.textContent = rate + ' FPS'; menu.appendChild(item);
  }
  const button = document.createElement('button'); button.id = 'selectFramerate'; button.textContent = selected + ' FPS';
  document.body.appendChild(menu); document.body.appendChild(button);
  const state = {value: selected, resets: 0, chosen: []};
  const context = vm.createContext({document, String, Number, Math, Array});
  vm.runInContext(source, context);
  const sync = (x100, stored) => context.HighRefreshMenu.sync({document, menu, button, x100, stored,
    value: () => state.value, choose: value => { state.value = value; state.chosen.push(value); }, onReset: () => state.resets++});
  const rates = () => menu.children.map(item => item.getAttribute('data-value'));
  return {document, menu, button, state, sync, rates, context};
}

// A 60 Hz or unmeasured panel: the menu stays 30 and 60.
for (const x100 of [6000, 5994, 0, undefined, NaN]) {
  const p = page();
  p.sync(x100);
  assert.deepStrictEqual(p.rates(), ['30', '60'], 'measured ' + x100);
  assert.deepStrictEqual(p.state.chosen, []);
}

// A 120 Hz panel adds one option, last, with the same Experimental badge the audio options use.
{
  const p = page();
  p.sync(12000);
  assert.deepStrictEqual(p.rates(), ['30', '60', '120']);
  p.sync(12000); p.sync(11988);
  assert.deepStrictEqual(p.rates(), ['30', '60', '120'], 'idempotent');
  const item = p.menu.children[2];
  assert(item.classList.contains('mdl-menu__item'));
  assert.strictEqual(item.children.length, 2);
  assert.strictEqual(item.children[0].className, 'framerate-option-label');
  assert.strictEqual(item.children[0].textContent.trim(), '120 FPS');
  assert(item.children[1].classList.contains('badge') && item.children[1].classList.contains('badge-experimental'));
  assert.strictEqual(item.children[1].textContent, 'Experimental');
  assert.strictEqual(p.button.textContent, '60 FPS', 'the current choice is untouched');
  assert.deepStrictEqual(p.state.chosen, []);
}

// A stored 120 comes back once the panel is known to support it, shown with its badge.
{
  const p = page('60');
  p.sync(6000, '120');
  assert.strictEqual(p.state.value, '60', 'not on a 60 Hz panel');
  p.sync(12000, '120');
  assert.strictEqual(p.state.value, '120');
  assert.deepStrictEqual(p.state.chosen, ['120']);
  assert.strictEqual(p.button.children[0].textContent.trim(), '120 FPS');
  assert(p.button.children[1].classList.contains('badge-experimental'));
  // Choosing something else afterwards is not undone by another measurement.
  p.state.value = '60';
  p.sync(12000, undefined);
  assert.strictEqual(p.state.value, '60');
}

// A 120 selection that the panel does not support (a different TV, a bad measurement) returns to 60.
{
  const p = page('120');
  p.sync(12000);
  p.state.value = '120';
  p.sync(6000);
  assert.deepStrictEqual(p.rates(), ['30', '60'], 'the option is withdrawn');
  assert.strictEqual(p.state.value, '60');
  assert.strictEqual(p.state.resets, 1);
  assert.strictEqual(p.button.textContent, '60 FPS');
  p.sync(6000);
  assert.strictEqual(p.state.resets, 1, 'told once');
}

// render() shows a plain option as text and a labelled one as label plus badge.
{
  const p = page('60');
  p.sync(12000);
  p.context.HighRefreshMenu.render(p.button, p.menu.children[2]);
  assert.strictEqual(p.button.children.length, 2);
  p.context.HighRefreshMenu.render(p.button, p.menu.children[0]);
  assert.strictEqual(p.button.children.length, 0);
  assert.strictEqual(p.button.textContent, '30 FPS');
}

// Missing pieces never throw.
{
  const p = page();
  for (const options of [undefined, null, {}, {menu: null, button: null, document: null}, {document: p.document, menu: p.menu}]) {
    assert.doesNotThrow(() => p.context.HighRefreshMenu.sync(options));
  }
  assert.doesNotThrow(() => p.context.HighRefreshMenu.render(null, null));
}
console.log('high_refresh_menu_test: 120 listed with the Experimental badge only on a measured 120 Hz panel, stored 120 restored, unsupported 120 back to 60 PASS');

'use strict';
// The settings glue for the experimental 120 FPS, from the production index.js functions: choosing and
// restoring the value, the Experimental notice, and the panel measurement arriving later.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const {createDocument} = require('./fixtures/mini-dom.cjs');
const index = fs.readFileSync('wasm/platform/index.js', 'utf8');
const body = name => {
  const start = index.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' exists');
  const next = index.indexOf('\nfunction ', start + 10);
  return index.slice(start, next < 0 ? index.length : next);
};
const modules = ['high-refresh.js', 'high-refresh-menu.js'].map(file => fs.readFileSync('wasm/platform/' + file, 'utf8')).join('\n');
const KEY = 'vibelight.high-refresh.pending';

function page(options = {}) {
  const document = createDocument(), notices = [], stored = [], calls = {presets: 0, warnings: 0};
  const menu = document.createElement('ul'); menu.setAttribute('class', 'videoFramerateMenu');
  for (const rate of ['30', '60']) {
    const item = document.createElement('li'); item.setAttribute('data-value', rate); item.classList.add('mdl-menu__item');
    item.textContent = rate + ' FPS'; menu.appendChild(item);
  }
  const button = document.createElement('button'); button.id = 'selectFramerate'; button.textContent = '60 FPS';
  document.body.appendChild(menu); document.body.appendChild(button);
  document.querySelector = selector => selector === '.videoFramerateMenu' ? menu : null;
  const data = new Map([['#selectFramerate', '60']]);
  const jq = selector => {
    const key = selector;   // a selector string or an element
    return {
      data(name, value) {
        if (typeof key !== 'string') return key.getAttribute('data-' + name);
        if (value !== undefined) { data.set(key, value); return this; }
        return data.get(key);
      },
      text(value) {
        if (value === undefined) return typeof key === 'string' ? '' : key.textContent;
        if (key === '#selectFramerate') button.textContent = value;
        return this;
      },
      each(fn) { if (key === '.videoFramerateMenu li') menu.children.slice().forEach(item => fn.call(item)); return this; }
    };
  };
  const map = new Map();
  const context = vm.createContext({document, $: jq, String, Number, Math, Array, console: {log() {}},
    storeData: (k, v) => stored.push([k, v]), standardBitratePresets: () => calls.presets++, warnResolutionFramerate: () => calls.warnings++,
    snackbarLog: text => notices.push(text), snackbarLogLong: text => notices.push(text),
    localStorage: {getItem: k => map.has(k) ? map.get(k) : null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k)}});
  vm.runInContext(modules, context);
  vm.runInContext('var highRefreshStored;\n' + ['saveFramerate', 'restoreFramerate', 'applyHighRefresh'].map(body).join('\n'), context);
  if (options.armed) context.HighRefresh.arm(context.localStorage);
  return {document, menu, button, notices, stored, calls, context, map, value: () => data.get('#selectFramerate'),
    rates: () => menu.children.map(item => item.getAttribute('data-value')),
    pick: rate => context.saveFramerate.call(menu.children.find(item => item.getAttribute('data-value') === rate))};
}

// A stored 30 or 60 is restored as before, and the new rules stay out of the way.
for (const rate of ['30', '60']) {
  const p = page();
  p.context.restoreFramerate(rate);
  assert.strictEqual(p.value(), rate);
  assert.strictEqual(p.button.textContent, rate + ' FPS');
  assert.deepStrictEqual(p.stored, []); assert.deepStrictEqual(p.notices, []);
}
{ const p = page(); p.context.restoreFramerate(null); p.context.restoreFramerate(undefined); p.context.restoreFramerate('bad'); assert.strictEqual(p.value(), '60'); }

// A stored 120 waits for the measurement: nothing is shown or changed until the panel is known to support it.
{
  const p = page();
  p.context.restoreFramerate('120');
  assert.strictEqual(p.value(), '60'); assert.strictEqual(p.button.textContent, '60 FPS');
  p.context.applyHighRefresh(6000);
  assert.strictEqual(p.value(), '60', 'a 60 Hz panel keeps 60');
  assert.deepStrictEqual(p.stored, [], 'and the stored 120 is not overwritten');
  p.context.applyHighRefresh(12000);
  assert.strictEqual(p.value(), '120');
  assert.strictEqual(p.button.children[0].textContent.trim(), '120 FPS');
  assert(p.button.children[1].classList.contains('badge-experimental'));
  assert.deepStrictEqual(p.stored, [], 'restoring is not saving');
  assert.strictEqual(p.calls.presets, 0, 'the saved bitrate is untouched');
  assert.deepStrictEqual(p.notices, []);
}

// The user picks 120: shown with its badge, saved, the bitrate preset follows and a notice says it is experimental.
{
  const p = page();
  p.context.applyHighRefresh(12000);
  p.pick('120');
  assert.strictEqual(p.value(), '120');
  assert.strictEqual(p.button.children.length, 2);
  assert.deepStrictEqual(p.stored, [['frameRate', '120']]);
  assert.strictEqual(p.calls.presets, 1);
  assert.strictEqual(p.notices.length, 1);
  assert(/experimental/i.test(p.notices[0]), 'the notice says it is experimental');
  p.pick('60');
  assert.strictEqual(p.value(), '60'); assert.strictEqual(p.button.textContent, '60 FPS');
  assert.strictEqual(p.notices.length, 1, 'no notice for 60');
  // A choice made by the user is not overridden by an old stored value on a later measurement.
  p.context.restoreFramerate('120'); p.context.highRefreshStored = undefined;
  p.context.applyHighRefresh(12000);
  assert.strictEqual(p.value(), '60');
}

// An interrupted 120 FPS start puts 60 back, saves it, says so once, and clears the guard.
{
  const p = page({armed: true});
  p.context.restoreFramerate('120');
  assert.strictEqual(p.value(), '60');
  assert.deepStrictEqual(p.stored, [['frameRate', '60']]);
  assert.strictEqual(p.notices.length, 1);
  assert.strictEqual(p.map.has(KEY), false);
  p.context.applyHighRefresh(12000);
  assert.strictEqual(p.value(), '60', 'the stored 120 is gone: not brought back by the measurement');
}

// A 120 choice on a panel later measured as not supporting it returns to 60 (and says so).
{
  const p = page();
  p.context.applyHighRefresh(12000);
  p.pick('120');
  p.stored.length = 0; p.notices.length = 0; p.calls.presets = 0;
  p.context.applyHighRefresh(6000);
  assert.strictEqual(p.value(), '60');
  assert.deepStrictEqual(p.stored, [['frameRate', '60']]);
  assert.strictEqual(p.calls.presets, 1);
  assert.strictEqual(p.notices.length, 1);
  assert.deepStrictEqual(p.rates(), ['30', '60']);
}
console.log('high_refresh_settings_test: stored 120 waits for the measurement, pick shows the badge and warns, interrupted start returns to 60 PASS');

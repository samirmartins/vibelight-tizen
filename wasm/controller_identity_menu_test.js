'use strict';
// Real menu identity module with synthetic browser pads and DOM. No TV.
const assert = require('assert'), fs = require('fs'), vm = require('vm');

function node(id) {
  return {
    id: id || '', hidden: false, textContent: '', attrs: {}, children: [], focused: 0,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] === undefined ? null : this.attrs[name]; },
    appendChild(child) { this.children.push(child); return child; },
    focus() { this.focused++; },
    blur() {}
  };
}
function fixture() {
  let pads = [];
  const nodes = new Map(), events = {};
  const badge = node('controllerPlayers');
  const family = node('navGuideFamily');
  const spans = {
    accept: node(), back: node(), face2: node(), face3: node(), lb: node(), rb: node(),
    lt: node(), rt: node(), select: node(), start: node(), guide: node()
  };
  Object.keys(spans).forEach(key => spans[key].setAttribute('data-gamepad', key));
  nodes.set('controllerPlayers', badge);
  nodes.set('navGuideFamily', family);
  const c = {
    console: {log() {}, warn() {}, error() {}},
    Object, Array, Math, Number, String, JSON, isFinite,
    isInGame: false,
    navigator: {getGamepads() { return pads; }},
    MenuI18n: {text: value => value},
    document: {
      hidden: false,
      getElementById(id) {
        if (nodes.has(id)) return nodes.get(id);
        const created = node(id); nodes.set(id, created); return created;
      },
      querySelectorAll() { return Object.keys(spans).map(key => spans[key]); },
      addEventListener(name, handler) { (events[name] = events[name] || []).push(handler); }
    },
    window: null
  };
  c.window = c;
  c.window.addEventListener = (name, handler) => { (events[name] = events[name] || []).push(handler); };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/controller-identity.js', 'utf8'), c);
  function setPads(value) { pads = value; }
  function dispatch(name, gamepad) {
    (events[name] || []).forEach(handler => handler({gamepad}));
  }
  return {c, badge, family, spans, setPads, dispatch, events};
}
function pad(index, id) {
  return {index, id, connected: true, timestamp: 1, buttons: [], axes: []};
}

{
  const f = fixture();
  const ids = [
    ['Xbox Wireless Controller', 'xbox'],
    ['XInput Controller', 'xbox'],
    ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'playstation'],
    ['054c-0ce6-DualSense', 'playstation'],
    ['Nintendo Switch Pro Controller', 'nintendo'],
    ['057e-2009-Pro Controller', 'nintendo'],
    ['USB Gamepad', 'unknown']
  ];
  ids.forEach(([id, expected]) => assert.strictEqual(f.c.ControllerIdentity.detect(id), expected, id));
  assert.strictEqual(f.c.ControllerIdentity.detect(''), 'unknown');
  f.c._gpControllerType = () => 3;
  assert.strictEqual(f.c.ControllerIdentity.familyOf({id: 'canonical-publisher-type'}), 'nintendo',
    'the menu reuses the streaming publisher detector when available');
  delete f.c._gpControllerType;

  f.setPads([pad(2, 'Nintendo Switch Pro Controller'), pad(0, 'Xbox Wireless Controller')]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.c.ControllerIdentity.players())), [
    {player: 1, index: 0, family: 'xbox'},
    {player: 2, index: 2, family: 'nintendo'}
  ]);
  assert.strictEqual(f.c.ControllerIdentity.primaryFamily(), 'xbox');
  assert.strictEqual(f.c.ControllerIdentity.familyAt(2), 'nintendo');
  assert.strictEqual(f.c.ControllerIdentity.familyAt(9), 'unknown');
  assert.strictEqual(f.c.ControllerIdentity.acceptButton(0), 0);
  assert.strictEqual(f.c.ControllerIdentity.backButton(0), 1);
  assert.strictEqual(f.c.ControllerIdentity.acceptButton(2), 1, 'Nintendo physical A is button 1');
  assert.strictEqual(f.c.ControllerIdentity.backButton(2), 0, 'Nintendo physical B is button 0');

  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.c.ControllerIdentity.labels('xbox'))),
    {accept: 'A', back: 'B', face2: 'X', face3: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT',
     select: 'View', start: 'Menu', guide: 'Guide'});
  assert.strictEqual(f.c.ControllerIdentity.labels('playstation').accept, '✕');
  assert.strictEqual(f.c.ControllerIdentity.labels('playstation').back, '○');
  assert.strictEqual(f.c.ControllerIdentity.labels('nintendo').accept, 'A');
  assert.strictEqual(f.c.ControllerIdentity.labels('nintendo').lb, 'L');
  assert.strictEqual(f.c.ControllerIdentity.labels('nintendo').rt, 'ZR');

  f.c.ControllerIdentity.refreshPlayers();
  assert.strictEqual(f.badge.hidden, false);
  assert.strictEqual(f.badge.textContent, 'Controller 1 · Xbox   Controller 2 · Nintendo');
  f.c.isInGame = true;
  f.c.ControllerIdentity.refreshPlayers();
  assert.strictEqual(f.badge.hidden, true, 'no player badge during a stream');
  f.c.isInGame = false;
  f.c.document.hidden = true;
  f.c.ControllerIdentity.refreshPlayers();
  assert.strictEqual(f.badge.hidden, true, 'no player badge while hidden');
  f.c.document.hidden = false;

  f.c.ControllerIdentity.localizeGuide();
  assert.strictEqual(f.spans.accept.textContent, 'A');
  assert.strictEqual(f.spans.back.textContent, 'B');
  assert.strictEqual(f.spans.lb.textContent, 'LB');
  assert.strictEqual(f.spans.start.textContent, 'Menu');
  assert.strictEqual(f.spans.guide.textContent, 'Guide');
  assert.strictEqual(f.family.textContent, '(Xbox)');

  f.setPads([pad(0, 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')]);
  f.dispatch('gamepadconnected', {index: 0});
  assert.strictEqual(f.badge.textContent, 'Controller 1 · PlayStation');
  f.c.ControllerIdentity.localizeGuide();
  assert.strictEqual(f.spans.accept.textContent, '✕');
  assert.strictEqual(f.spans.back.textContent, '○');
  assert.strictEqual(f.spans.face2.textContent, '□');
  assert.strictEqual(f.spans.start.textContent, 'Options');
  assert.strictEqual(f.family.textContent, '(PlayStation)');

  f.setPads([]);
  f.dispatch('gamepaddisconnected', {index: 0});
  assert.strictEqual(f.badge.hidden, true, 'disconnect hides the badge');

  const source = fs.readFileSync('wasm/platform/controller-identity.js', 'utf8');
  assert(!/setTimeout|setInterval|requestAnimationFrame|console\./.test(source), 'event-only, no timers or logs');
  assert(!/host|mac|ip/i.test(source.split('function detect')[0]), 'no network state');
  console.log('controller_identity_menu_test: name/VID detection, cache-backed families, players P1–P4, Nintendo A/B, dynamic glyphs, guide localization and badge PASS');
}

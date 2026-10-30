'use strict';
// Real quick-help module with synthetic DOM/Navigation and a PlayStation pad.
const assert = require('assert'), fs = require('fs'), vm = require('vm');

function node(id) {
  return {
    id: id || '', hidden: false, textContent: '', className: '', children: [], attrs: {}, focused: 0,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] === undefined ? null : this.attrs[name]; },
    appendChild(child) { this.children.push(child); return child; },
    focus() { this.focused++; },
    blur() {}
  };
}
function fixture() {
  const nodes = new Map(), events = {}, calls = {push: [], pop: 0, focus: 0, mark: 0, unmark: 0};
  const c = {
    console: {log() {}, warn() {}, error() {}},
    Object, Array, Math, Number, String, isFinite,
    isInGame: false,
    isDialogOpen: false,
    document: {
      hidden: false,
      body: node('body'),
      createElement(tag) { return node('created-' + tag + '-' + nodes.size); },
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, node(id));
        return nodes.get(id);
      },
      addEventListener(name, handler) { (events[name] = events[name] || []).push(handler); }
    },
    MenuI18n: {text: value => value},
    ControllerIdentity: {
      primaryFamily: () => 'playstation',
      labels: () => ({accept: '✕', back: '○', face2: '□', face3: '△', lb: 'L1', rb: 'R1',
        lt: 'L2', rt: 'R2', select: 'Create', start: 'Options', guide: 'PS'})
    },
    focusElement(element) { calls.focus++; calls.focused = element; },
    mark() { calls.mark++; },
    unmark() { calls.unmark++; },
    Navigation: {
      isRunning: () => true,
      push(view) { calls.push.push(view); view.enter(); },
      pop() { calls.pop++; }
    }
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/quick-help.js', 'utf8'), c);
  function lookup(root, id) {
    if (!root) return null;
    if (root.id === id) return root;
    for (let i = 0; i < (root.children || []).length; i++) {
      const found = lookup(root.children[i], id);
      if (found) return found;
    }
    return null;
  }
  return {c, calls, nodes, events, find: id => lookup(c.document.body, id)};
}

{
  const f = fixture();
  assert.strictEqual(f.c.QuickHelp.open(), true);
  assert.strictEqual(f.c.isDialogOpen, true);
  assert.strictEqual(f.find('quickHelpOverlay').hidden, false);
  assert.strictEqual(f.calls.push.length, 1);
  assert.strictEqual(f.calls.focus, 1);
  const rows = f.find('quickHelpRows').children;
  assert.strictEqual(rows.length, 9);
  const text = rows.map(row => row.children.map(child => child.textContent).join('=')).join('\n');
  assert(text.includes('Accept=✕'), 'accept glyph follows the family');
  assert(text.includes('Back=○'), 'back glyph follows the family');
  assert(text.includes('Library filters=L1 / R1'));
  assert(text.includes('Page the library=L2 / R2'));
  assert(text.includes('Favorite game=□'));
  assert(text.includes('Quick help=Options'));
  assert(text.includes('Navigation guide=PS'));
  assert(text.includes('Navigate=D-pad / Left stick'));

  const view = f.calls.push[0];
  view.back();
  assert.strictEqual(f.c.QuickHelp.isOpen(), false);
  assert.strictEqual(f.c.isDialogOpen, false);
  assert.strictEqual(f.find('quickHelpOverlay').hidden, true);
  assert.strictEqual(f.calls.pop, 1);

  assert.strictEqual(f.c.QuickHelp.toggle(), true);
  assert.strictEqual(f.c.QuickHelp.isOpen(), true);
  f.calls.push[1].accept();
  assert.strictEqual(f.c.QuickHelp.isOpen(), false);

  f.c.isInGame = true;
  assert.strictEqual(f.c.QuickHelp.open(), false, 'no help during a stream');
  f.c.isInGame = false;
  f.c.isDialogOpen = true;
  assert.strictEqual(f.c.QuickHelp.open(), false, 'no help over another dialog');
  f.c.isDialogOpen = false;
  f.c.document.hidden = true;
  assert.strictEqual(f.c.QuickHelp.open(), false, 'no help while hidden');
  f.c.document.hidden = false;

  assert.strictEqual(f.c.QuickHelp.toggle(), true);
  f.c.document.hidden = true;
  f.events.visibilitychange.forEach(handler => handler());
  assert.strictEqual(f.c.QuickHelp.isOpen(), false, 'hidden window closes the help');
  assert.strictEqual(f.c.isDialogOpen, false);

  const source = fs.readFileSync('wasm/platform/quick-help.js', 'utf8');
  assert(!/setTimeout|setInterval|requestAnimationFrame/.test(source), 'no timers or frame loop');
  console.log('quick_help_test: family glyphs, all menu rows, open/close/toggle, dialog/stream guards, visibility and no timers PASS');
}

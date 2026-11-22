'use strict';
// TV remote OK key: the app handles it through Navigation.accept(), so the browser must not
// ALSO run its default activation (a second click on whatever holds focus after the
// handler changed it). That double activation reopened dialogs, closed dialogs it had just
// opened and moved focus to another field. Typing in real text fields must keep working.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const source = fs.readFileSync('wasm/platform/remote_controller.js', 'utf8');
const KEYS = {KEY_UP: 38, KEY_DOWN: 40, KEY_LEFT: 37, KEY_RIGHT: 39, KEY_ENTER: 13, KEY_REMOTE_ENTER: 32, KEY_RETURN: 10009,
  KEY_VOLUME_UP: 447, KEY_VOLUME_DOWN: 448, KEY_VOLUME_MUTE: 449, KEY_CHANNEL_UP: 427, KEY_CHANNEL_DOWN: 428,
  KEY_RED: 403, KEY_YELLOW: 405};

function env(active) {
  const calls = [];
  const navigation = {};
  for (const name of ['up', 'down', 'left', 'right', 'accept', 'back', 'press', 'switch']) navigation[name] = () => calls.push(name);
  const context = vm.createContext({
    tvKey: KEYS, Navigation: navigation, isInGame: false, Module: {},
    document: {activeElement: active},
    tizen: {tvaudiocontrol: {setVolumeUp() { calls.push('volume-up'); }, setVolumeDown() { calls.push('volume-down'); }, setMute() { calls.push('mute'); }}}
  });
  vm.runInContext(source + '\nthis.handler = remoteControllerHandler;', context);
  const press = (keyCode, cancelable = true) => {
    const event = {keyCode, cancelable, prevented: false, preventDefault() { this.prevented = true; }};
    context.handler(event);
    return event;
  };
  return {press, calls};
}
const element = (tag, extra = {}) => Object.assign({tagName: tag, type: '', isContentEditable: false}, extra);

// OK on buttons, toggles and rows: the app acts once and the browser default is cancelled.
for (const active of [element('BUTTON'), element('DIV'), element('A'), element('LI'), element('INPUT', {type: 'checkbox'}),
  element('INPUT', {type: 'radio'}), element('INPUT', {type: 'range'}), element('INPUT', {type: 'button'}), null]) {
  for (const code of [KEYS.KEY_ENTER, KEYS.KEY_REMOTE_ENTER]) {
    const e = env(active), event = e.press(code);
    assert.deepStrictEqual(e.calls, ['accept']);
    assert.strictEqual(event.prevented, true, `${active && active.tagName}/${active && active.type} key ${code} must cancel the default click`);
  }
}

// Real text entry keeps the browser behavior (Enter confirms the field / the TV keyboard).
for (const active of [element('INPUT', {type: 'text'}), element('INPUT', {type: ''}), element('INPUT', {type: 'password'}),
  element('INPUT', {type: 'number'}), element('INPUT', {type: 'search'}), element('TEXTAREA'), element('SELECT'),
  element('DIV', {isContentEditable: true})]) {
  const e = env(active), event = e.press(KEYS.KEY_ENTER);
  assert.deepStrictEqual(e.calls, ['accept']);
  assert.strictEqual(event.prevented, false, `${active.tagName}/${active.type} keeps its default`);
}

// An event that cannot be cancelled is left alone (and does not throw).
{
  const e = env(element('BUTTON')), event = e.press(KEYS.KEY_ENTER, false);
  assert.deepStrictEqual(e.calls, ['accept']);
  assert.strictEqual(event.prevented, false);
}

// Other keys are unchanged: same actions, no cancellation added.
for (const [code, expected] of [[KEYS.KEY_UP, 'up'], [KEYS.KEY_DOWN, 'down'], [KEYS.KEY_LEFT, 'left'], [KEYS.KEY_RIGHT, 'right'],
  [KEYS.KEY_RETURN, 'back'], [KEYS.KEY_CHANNEL_UP, 'press'], [KEYS.KEY_CHANNEL_DOWN, 'switch'],
  [KEYS.KEY_VOLUME_UP, 'volume-up'], [KEYS.KEY_VOLUME_DOWN, 'volume-down'], [KEYS.KEY_VOLUME_MUTE, 'mute']]) {
  const e = env(element('BUTTON')), event = e.press(code);
  assert.deepStrictEqual(e.calls, [expected]);
  assert.strictEqual(event.prevented, false, `key ${code} behavior unchanged`);
}
console.log('remote_controller_test: OK is handled once (default click cancelled), text fields and other keys unchanged PASS');

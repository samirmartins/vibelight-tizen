'use strict';
// The setting "When the PC is off": one button that cycles Ask -> Wake and play -> Just try to
// play, saved at once, shown on load, back to Ask with the other defaults. Production module,
// markup, navigation list and index.js wiring.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const context = vm.createContext({String});
vm.runInContext(fs.readFileSync('wasm/platform/wake-and-play.js', 'utf8'), context);
const api = context.WakeAndPlay;
const store = (initial = {}, broken = false) => {
  const data = Object.assign({}, initial);
  return {getItem: k => { if (broken) throw Error('x'); return k in data ? data[k] : null; }, setItem: (k, v) => { if (broken) throw Error('x'); data[k] = String(v); }, data};
};

// Labels for each choice.
assert.strictEqual(api.choiceLabel('ask'), 'Ask');
assert.strictEqual(api.choiceLabel('wake'), 'Wake and play');
assert.strictEqual(api.choiceLabel('never'), 'Try to play anyway');
assert.strictEqual(api.choiceLabel('bogus'), 'Ask');

// Shown on load from what is stored (Ask when nothing valid).
let button = {textContent: ''}, storage = store();
api.show(button, storage); assert.strictEqual(button.textContent, 'Ask');
api.show(button, store({[api.KEY]: 'never'})); assert.strictEqual(button.textContent, 'Try to play anyway');
api.show(button, store({[api.KEY]: 'junk'})); assert.strictEqual(button.textContent, 'Ask');

// Each press moves to the next choice, saves it and shows it.
api.show(button, storage);
api.cycle(button, storage); assert.strictEqual(button.textContent, 'Wake and play'); assert.strictEqual(storage.data[api.KEY], 'wake');
api.cycle(button, storage); assert.strictEqual(button.textContent, 'Try to play anyway'); assert.strictEqual(storage.data[api.KEY], 'never');
api.cycle(button, storage); assert.strictEqual(button.textContent, 'Ask'); assert.strictEqual(storage.data[api.KEY], 'ask');

// Restoring defaults goes back to Ask.
api.cycle(button, storage); api.reset(button, storage);
assert.strictEqual(button.textContent, 'Ask'); assert.strictEqual(api.policy(storage), 'ask');

// A blocked storage never throws and the button still shows what is in effect (Ask).
const broken = store({}, true); button = {textContent: ''};
api.show(button, broken); api.cycle(button, broken); api.reset(button, broken);
assert.strictEqual(button.textContent, 'Ask');
api.show(null, storage); api.cycle(null, storage); api.reset(undefined, storage); // no button: no crash

// The page: one button in the Library section, reachable with the remote, wired at start-up.
const html = fs.readFileSync('wasm/index.html', 'utf8'), nav = fs.readFileSync('wasm/platform/navigation.js', 'utf8'), index = fs.readFileSync('wasm/platform/index.js', 'utf8');
assert.strictEqual(html.split('id="wakePlayPolicyBtn"').length - 1, 1);
const library = html.slice(html.indexOf('>Library</h2>'), html.indexOf('>Maintenance</h2>'));
assert(library.includes('id="wakePlayPolicyBtn"'), 'in the Library settings section');
assert(/<button type="button" id="wakePlayPolicyBtn" class="mdl-button mdl-js-button mdl-js-ripple-effect">Ask<\/button>/.test(html));
assert(/<label>When the PC is off<\/label>/.test(library));
const hostList = nav.slice(nav.indexOf('HostSettings: {'), nav.indexOf('removeAllProfilesBtn'));
assert(hostList.indexOf("'sortAppsListBtn'") < hostList.indexOf("'wakePlayPolicyBtn'"), 'right after the sort option, before the maintenance buttons');
assert(/\$\('#wakePlayPolicyBtn'\)\.on\('click'/.test(index), 'a press cycles the choice');
assert(/WakeAndPlay\.show\(/.test(index), 'the stored choice is shown at start-up');
const reset = index.slice(index.indexOf('function restoreDefaultsSettingsValues('));
assert(/WakeAndPlay\.reset\(/.test(reset.slice(0, reset.indexOf('\n}\n'))), 'restore defaults resets it');
assert(/typeof WakeAndPlay !== 'undefined'/.test(index), 'a missing module cannot stop the settings');
console.log('wake_and_play_settings_test: OK');

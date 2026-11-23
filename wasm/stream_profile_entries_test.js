'use strict';
// Where profiles are opened and removed: the PC card menu, the library button,
// deleting PCs and "Remove all profiles". Restore defaults leaves profiles alone.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const index = fs.readFileSync('wasm/platform/index.js', 'utf8');
const html = fs.readFileSync('wasm/index.html', 'utf8');
const KEY = 'vibelight.stream-profiles.v1';
const plain = value => JSON.parse(JSON.stringify(value));
const from = (start, end) => {
  const a = index.indexOf(start);
  assert(a >= 0, 'missing ' + start);
  const b = end ? index.indexOf(end, a) : index.indexOf('\n}\n', a) + 3;
  assert(b > a, 'missing end of ' + start);
  return index.slice(a, b);
};

// ---- PC card menu and navigation lists
{
  const navigation = vm.createContext({console, Array, Object, Math, Number, String, setTimeout() { return 1; }, clearTimeout() {},
    document: {getElementById: () => null, querySelectorAll: () => []}, addEventListener() {}, removeEventListener() {}});
  navigation.window = navigation;
  vm.runInContext(fs.readFileSync('wasm/platform/navigation.js', 'utf8') + '\nglobalThis.Views = Views;', navigation);
  const context = vm.createContext({console, Array, Object, snackbarLogLong() {}, snackbarLog() {}, deleteHostDialog() {}, hostDetailsDialog() {},
    WakeHost: {open() {}}, setTimeout: fn => fn(), openStreamProfileEditor(...args) { context.opened.push(args); }, opened: []});
  vm.runInContext(from('function hostMenuActions(', '\nfunction hostMenuDialog('), context);
  const host = {hostname: 'Fixture PC', serverUid: 'pc-a', clearBoxArt() {}, getAppListWithCacheFlush() {}};
  const actions = context.hostMenuActions(host);
  assert.deepStrictEqual(plain(actions.map(a => [a.id, a.text])), [
    ['refreshApps-Fixture PC', 'Refresh games'], ['wakeHost-Fixture PC', 'Wake PC (Wake-on-LAN)'],
    ['streamProfile-Fixture PC', 'Stream profile'], ['deleteHost-Fixture PC', 'Delete PC'], ['viewDetails-Fixture PC', 'View Details']]);
  actions.find(a => a.id.startsWith('streamProfile-')).action();
  assert.strictEqual(context.opened.length, 1);
  assert.strictEqual(context.opened[0][0], 'host');
  assert.strictEqual(context.opened[0][1], host);
  // The controller list matches the generated buttons, in order, with Close last.
  navigation.Views.HostMenuDialog.hostname = 'Fixture PC';
  assert.deepStrictEqual(plain(navigation.Views.HostMenuDialog.view.func()), [...actions.map(a => a.id), 'closeHostMenu']);
  // Settings lists the maintenance action.
  assert(plain(navigation.Views.HostSettings.view.func()).includes('removeAllProfilesBtn'));
  assert(html.includes('id="removeAllProfilesBtn"'));
}

// ---- Opening the editor passes the right request
{
  const requests = [];
  const context = vm.createContext({maxSupportedWidth: 2560, StreamProfileMenu: {open: request => requests.push(request)},
    currentStreamSettings: () => ({resolution: '1920:1080'})});
  vm.runInContext(from('function openStreamProfileEditor('), context);
  context.openStreamProfileEditor('game', {serverUid: 'pc-a', hostname: 'Fixture PC'}, {id: 7, title: 'Example Game'});
  context.openStreamProfileEditor('host', {serverUid: 'pc-a', hostname: 'Fixture PC'});
  assert.deepStrictEqual(plain(requests), [
    {scope: 'game', uid: 'pc-a', appId: 7, title: 'Example Game', settings: {resolution: '1920:1080'}, limits: {maxWidth: 2560}, opener: 'libraryProfile'},
    {scope: 'host', uid: 'pc-a', title: 'Fixture PC', settings: {resolution: '1920:1080'}, limits: {maxWidth: 2560}, opener: 'host-container-pc-a'}]);
}

// ---- Deleting PCs and removing all profiles
function dialogs(initial) {
  const store = new Map([[KEY, JSON.stringify(initial)]]);
  const handlers = new Map(), notices = [], overlay = {style: {}}, dialog = {open: false, showModal() { this.open = true; }, close() { this.open = false; }};
  const elements = {deleteHostDialogTitle: {}, deleteHostDialogText: {}};
  const removedContainers = [];
  const dollar = selector => ({off() { return this; }, on(event, fn) { handlers.set(selector + ':' + event, fn); return this; }, remove() { removedContainers.push(selector); return this; }});
  const context = vm.createContext({console, Object, Array, JSON, Number, String, isFinite, Math, $: dollar,
    localStorage: {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v)},
    document: {querySelector: selector => selector === '#deleteHostDialogOverlay' ? overlay : dialog, getElementById: id => elements[id]},
    isDialogOpen: false, Navigation: {push() {}, pop() {}, switch() {}}, Views: {DeleteHostDialog: {}, Hosts: {view: {reset() {}}}},
    hosts: {'pc-a': {serverUid: 'pc-a', hostname: 'A'}, 'pc-b': {serverUid: 'pc-b', hostname: 'B'}},
    saveHosts() {}, endBackgroundPollingOfHost() {}, stopPollingHosts() {}, snackbarLog: text => notices.push(text)});
  vm.runInContext(fs.readFileSync('wasm/platform/stream-profiles.js', 'utf8'), context);
  vm.runInContext(from('function deleteHostDialog(', '\nfunction deleteAllProfilesDialog(') + '\n' + from('function deleteAllProfilesDialog('), context);
  return {context, handlers, notices, overlay, dialog, elements, store, removedContainers,
    profiles: context.StreamProfiles, click: name => handlers.get('#' + name + ':click')()};
}
const seed = {version: 1, hosts: {'pc-a': {host: {bitrate: 20}, games: {7: {codec: 'AV1'}}}, 'pc-b': {host: {bitrate: 40}}}};
{
  // Delete PC: its profiles go, other PCs keep theirs, pairing handling is untouched.
  const d = dialogs(seed);
  d.context.deleteHostDialog(d.context.hosts['pc-a']);
  d.click('continueDeleteHost');
  assert.strictEqual(d.profiles.resolve('pc-a', 7).source, 'none');
  assert.strictEqual(d.profiles.resolve('pc-b', 1).source, 'host');
  assert.deepStrictEqual(Object.keys(d.context.hosts), ['pc-b']);
}
{
  // Delete all PCs: every profile goes.
  const d = dialogs(seed);
  d.context.deleteAllHostsDialog();
  d.click('continueDeleteHost');
  assert.deepStrictEqual(plain(d.profiles.get()), {version: 1, hosts: {}});
  assert.deepStrictEqual(Object.keys(d.context.hosts), []);
}
{
  // Remove all profiles: asks first, cancel keeps them, confirm removes only profiles.
  const d = dialogs(seed);
  d.context.deleteAllProfilesDialog();
  assert(d.dialog.open && d.overlay.style.display === 'flex');
  assert.strictEqual(d.elements.deleteHostDialogTitle.innerHTML, 'Remove All Profiles');
  assert(/PC and game profiles/.test(d.elements.deleteHostDialogText.textContent) && /pairings/.test(d.elements.deleteHostDialogText.textContent));
  d.click('cancelDeleteHost');
  assert(!d.dialog.open);
  assert.strictEqual(d.profiles.count().hosts, 2);
  d.context.deleteAllProfilesDialog();
  d.click('continueDeleteHost');
  assert.deepStrictEqual(plain(d.profiles.get()), {version: 1, hosts: {}});
  assert.deepStrictEqual(Object.keys(d.context.hosts), ['pc-a', 'pc-b'], 'PCs and pairings stay');
  assert.deepStrictEqual(d.notices, ['All streaming profiles have been removed.']);
  assert(!d.dialog.open);
  // Nothing to remove: no dialog, a short notice.
  const empty = dialogs({version: 1, hosts: {}});
  empty.context.deleteAllProfilesDialog();
  assert(!empty.dialog.open);
  assert.deepStrictEqual(empty.notices, ['No streaming profiles exist.']);
  // A failed write keeps the profiles and says so.
  const failing = dialogs(seed);
  failing.context.localStorage.setItem = () => { throw Error('QuotaExceededError'); };
  failing.context.deleteAllProfilesDialog();
  failing.click('continueDeleteHost');
  assert.strictEqual(failing.profiles.count().hosts, 2);
  assert.deepStrictEqual(failing.notices, ['Could not remove the profiles. Check storage and try again.']);
}

// ---- Restore defaults never touches profiles
{
  const restore = from('function restoreDefaultsSettingsValues(');
  assert(!/StreamProfiles|stream-profiles/.test(restore));
  const confirm = index.slice(index.indexOf("$('#continueRestoreDefaults')"), index.indexOf("$('#continueRestoreDefaults')") + 1500);
  assert(!/StreamProfiles/.test(confirm));
}

// ---- Library button
(async () => {
  const {fixture} = require('./fixtures/console-library.cjs');
  const f = fixture(3);
  const opened = [];
  f.c.openStreamProfileEditor = (...args) => opened.push(args);
  vm.runInContext(fs.readFileSync('wasm/platform/stream-profiles.js', 'utf8'), f.c);
  await f.open();
  const button = f.node('libraryProfile');
  assert.strictEqual(button.disabled, false);
  assert.strictEqual(button.textContent, 'Profile');
  button.onclick();
  assert.strictEqual(opened.length, 1);
  assert.strictEqual(opened[0][0], 'game');
  assert.strictEqual(opened[0][1], f.host);
  const app = opened[0][2], uid = String(f.host.serverUid);
  assert(Number.isInteger(app.id) && typeof app.title === 'string');
  // A PC-only profile does not mark every game; a game with its own profile is marked.
  assert(f.c.StreamProfiles.setHost(uid, {bitrate: 20}));
  f.suspend(); await f.open();
  assert.strictEqual(f.node('libraryProfile').textContent, 'Profile');
  assert(f.c.StreamProfiles.setGame(uid, app.id, {bitrate: 25}));
  f.suspend(); await f.open();
  assert.strictEqual(f.node('libraryProfile').textContent, 'Profile ●');
  // The button is in the controller order right after Favorite.
  const library = fs.readFileSync('wasm/platform/console-library.js', 'utf8');
  assert(/'libraryFavorite','libraryProfile','libraryAll'/.test(library));
  assert(html.includes('id="libraryProfile"'));
  // Scripts and stylesheet are loaded once, in dependency order.
  const profilesAt = html.indexOf('platform/stream-profiles.js'), menuAt = html.indexOf('platform/stream-profile-menu.js'), indexAt = html.indexOf('platform/index.js');
  assert(profilesAt > 0 && menuAt > profilesAt && indexAt > menuAt, 'profiles, then menu, then index');
  assert.strictEqual(html.split('platform/stream-profiles.js').length, 2);
  assert(html.includes('static/css/stream-profile.css'));
  assert(fs.existsSync('wasm/static/css/stream-profile.css'));
  f.suspend();
  console.log('stream_profile_entries_test: PC menu and controller list, library button, editor request, PC removal, remove-all confirmation and failures, restore defaults untouched, load order PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

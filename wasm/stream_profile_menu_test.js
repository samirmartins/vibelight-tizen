'use strict';
// The compact profile popup: one dialog sized to its content, controller
// navigation (up/down rows, left/right values), save, remove and cancel.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const {createDocument} = require('./fixtures/mini-dom.cjs');
const KEY = 'vibelight.stream-profiles.v1';
const SETTINGS = {resolution: '1920:1080', frameRate: '60', bitrate: 30, codec: 'H264', hdr: false, audio: 'Stereo'};

function env(options = {}) {
  const document = createDocument(), nav = {current: null, changes: 0, pops: 0}, notices = [], focused = [];
  document.hidden = !!options.hidden;
  const store = new Map(options.stored ? [[KEY, options.stored]] : []);
  const clock = {now: 0};
  const context = vm.createContext({
    document, JSON, Object, Array, Number, String, isFinite, Math,
    isInGame: !!options.inGame, isDialogOpen: !!options.dialogOpen,
    performance: {now: () => clock.now},
    localStorage: {getItem: k => store.has(k) ? store.get(k) : null,
      setItem(k, v) { if (options.failWrites) throw Error('QuotaExceededError'); store.set(k, v); }},
    Navigation: {change(view) { nav.current = view; nav.changes++; }, pop() { nav.pops++; }},
    openUtilityDialog(id, controls, closeId, opener) {
      const dialog = document.getElementById(id);
      dialog.showModal(); dialog.parentNode.style.display = 'flex'; context.isDialogOpen = true;
      nav.opened = {id, controls: Array.from(controls), closeId, opener};
    },
    closeUtilityDialog(id) {
      const dialog = document.getElementById(id);
      if (!dialog.open) return;
      dialog.close(); dialog.parentNode.style.display = 'none'; context.isDialogOpen = false; context.Navigation.pop();
    },
    focusElement(id) { focused.push(id); const node = document.getElementById(id); if (node) node.focus(); },
    snackbarLog(text) { notices.push(text); }
    // No setTimeout/setInterval on purpose: the menu must not need timers.
  });
  for (const file of ['stream-profiles.js', 'stream-profile-menu.js']) vm.runInContext(fs.readFileSync('wasm/platform/' + file, 'utf8'), context);
  return {document, context, nav, notices, focused, store, clock, menu: context.StreamProfileMenu, profiles: context.StreamProfiles};
}
const request = (overrides = {}) => ({scope: 'game', uid: 'pc-a', appId: 7, title: 'Example Game', settings: SETTINGS,
  limits: {maxWidth: 3840}, opener: 'libraryProfile', ...overrides});
const rowText = (e, id) => e.document.getElementById('sp-' + id).children.map(c => c.textContent);
const active = e => e.document.activeElement.id;
const stored = e => JSON.parse(e.store.get(KEY) || '{"hosts":{}}');

// Opening shows one compact dialog with six rows and three actions.
{
  const e = env();
  e.menu.open(request());
  const dialog = e.document.getElementById('streamProfileDialog');
  assert(dialog && dialog.open && dialog.parentNode.style.display === 'flex');
  assert.strictEqual(dialog.find('streamProfileTitle').textContent, 'Game profile — Example Game');
  assert.deepStrictEqual(e.nav.opened.controls, ['sp-resolution', 'sp-frameRate', 'sp-bitrate', 'sp-codec', 'sp-hdr', 'sp-audio', 'sp-save', 'sp-remove', 'sp-cancel']);
  assert.strictEqual(e.nav.opened.closeId, 'sp-cancel');
  assert.strictEqual(e.nav.opened.opener, 'libraryProfile');
  assert.deepStrictEqual(rowText(e, 'resolution'), ['Resolution', '◀ Default ▶', 'Settings: 1080p']);
  assert.deepStrictEqual(rowText(e, 'bitrate'), ['Bitrate', '◀ Default ▶', 'Settings: 30 Mbps']);
  assert.strictEqual(active(e), 'sp-resolution');
  assert.strictEqual(e.nav.current, e.menu.view);
  assert.strictEqual(e.document.getElementById('sp-remove').disabled, true, 'nothing to remove yet');
  assert.strictEqual(e.document.listenerCount('visibilitychange'), 1);
  // Cancel closes without writing anything and restores focus to the opener.
  e.document.getElementById('sp-cancel').click();
  assert(!dialog.open);
  assert.strictEqual(e.store.has(KEY), false);
  assert.strictEqual(e.focused.at(-1), 'libraryProfile');
  assert.strictEqual(e.document.listenerCount('visibilitychange'), 0);
  assert.strictEqual(e.nav.pops, 1);
  // Reopening reuses the same dialog element.
  e.menu.open(request());
  assert.strictEqual(e.document.body.children.length, 1);
}

// Controller navigation: up/down move between rows and actions, left/right change values.
{
  const e = env(), view = e.menu.view;
  e.menu.open(request());
  const path = [];
  for (let i = 0; i < 7; i++) { view.down(); path.push(active(e)); }
  assert.deepStrictEqual(path, ['sp-frameRate', 'sp-bitrate', 'sp-codec', 'sp-hdr', 'sp-audio', 'sp-save', 'sp-save'], 'down stops on the actions');
  view.right(); assert.strictEqual(active(e), 'sp-cancel', 'Remove is disabled and skipped');
  view.right(); assert.strictEqual(active(e), 'sp-cancel');
  view.left(); assert.strictEqual(active(e), 'sp-save');
  view.up(); assert.strictEqual(active(e), 'sp-audio');
  for (let i = 0; i < 8; i++) view.up();
  assert.strictEqual(active(e), 'sp-resolution', 'up stops on the first row');
  view.right();
  assert.deepStrictEqual(rowText(e, 'resolution'), ['Resolution', '◀ 480p ▶', 'Settings: 1080p']);
  view.right(); view.left(); view.left();
  assert.strictEqual(rowText(e, 'resolution')[1], '◀ Default ▶');
  view.accept();
  assert.strictEqual(rowText(e, 'resolution')[1], '◀ 480p ▶', 'OK on a row moves to its next value');
  view.back();
  assert(!e.document.getElementById('streamProfileDialog').open, 'Back cancels');
  assert.strictEqual(e.store.has(KEY), false);
}

// Bitrate steps of 0.5 Mbps; holding accelerates.
{
  const e = env(), view = e.menu.view;
  e.menu.open(request());
  for (let i = 0; i < 2; i++) view.down();
  assert.strictEqual(active(e), 'sp-bitrate');
  view.right();
  assert.strictEqual(rowText(e, 'bitrate')[1], '◀ 30 Mbps ▶');
  e.clock.now += 1000; view.right();
  assert.strictEqual(rowText(e, 'bitrate')[1], '◀ 30.5 Mbps ▶');
  // The hold started at 1000 ms: nine 0.5 steps (to 35), then three 5 Mbps steps at 2000, 2100 and 2200 ms.
  for (let i = 0; i < 12; i++) { e.clock.now += 100; view.right(); }
  assert.strictEqual(rowText(e, 'bitrate')[1], '◀ 50 Mbps ▶', '0.5 steps for one second, then 5 Mbps steps');
}

// Save writes the profile for this game on this PC and reports it.
{
  const e = env(), view = e.menu.view;
  e.menu.open(request());
  view.right();                             // resolution 480p
  view.down(); view.down(); view.down(); view.down();   // HDR row
  view.right();                             // HDR On (Settings codec is H.264)
  assert(e.document.getElementById('sp-status').textContent.includes('HDR needs HEVC or AV1'), 'HDR hint is shown');
  view.up(); view.right();                  // codec H.264 explicit
  view.down(); view.down(); view.down();    // actions
  assert.strictEqual(active(e), 'sp-save');
  e.document.getElementById('sp-save').click();
  assert(e.document.getElementById('streamProfileDialog').open, 'H.264 with HDR chosen explicitly cannot be saved');
  assert(e.document.getElementById('sp-status').textContent.includes('HDR needs HEVC or AV1'));
  assert.strictEqual(e.store.has(KEY), false);
  view.up(); view.up(); view.up(); view.left();   // Save -> audio -> HDR -> codec, then H.264 -> Default
  view.down(); view.down(); view.down();
  e.document.getElementById('sp-save').click();
  assert(!e.document.getElementById('streamProfileDialog').open);
  assert.deepStrictEqual(stored(e).hosts['pc-a'].games['7'], {resolution: '854:480', hdr: true});
  assert.deepStrictEqual(e.notices, ['Profile saved. It applies to the next stream.']);
  assert.strictEqual(e.focused.at(-1), 'libraryProfile');
}

// Reopening shows the stored profile and enables Remove, which deletes only this profile.
{
  const e = env(), view = e.menu.view;
  assert(e.profiles.setGame('pc-a', 7, {bitrate: 20, audio: '51Surround'}));
  assert(e.profiles.setGame('pc-a', 8, {bitrate: 10}));
  assert(e.profiles.setHost('pc-a', {codec: 'HEVC'}));
  e.menu.open(request());
  assert.deepStrictEqual(rowText(e, 'bitrate'), ['Bitrate', '◀ 20 Mbps ▶', 'Settings: 30 Mbps']);
  assert.strictEqual(rowText(e, 'audio')[1], '◀ 5.1 Surround Sound ▶');
  assert.strictEqual(e.document.getElementById('sp-remove').disabled, false);
  e.document.getElementById('sp-remove').click();
  assert(!e.document.getElementById('streamProfileDialog').open);
  assert.strictEqual(e.profiles.resolve('pc-a', 7).fields.bitrate, undefined, 'game profile removed');
  assert.strictEqual(e.profiles.resolve('pc-a', 7).fields.codec, 'host', 'PC profile kept');
  assert.strictEqual(e.profiles.resolve('pc-a', 8).fields.bitrate, 'game', 'other game kept');
  assert.deepStrictEqual(e.notices, ['Profile removed.']);
}

// Setting every row back to Default removes the profile on Save.
{
  const e = env(), view = e.menu.view;
  assert(e.profiles.setGame('pc-a', 7, {resolution: '1280:720'}));
  e.menu.open(request());
  view.left();                              // 720p -> 480p ... back to Default
  view.left();
  assert.strictEqual(rowText(e, 'resolution')[1], '◀ Default ▶');
  for (let i = 0; i < 6; i++) view.down();
  e.document.getElementById('sp-save').click();
  assert.strictEqual(e.profiles.resolve('pc-a', 7).source, 'none');
}

// PC scope writes the PC profile.
{
  const e = env();
  e.menu.open(request({scope: 'host', appId: undefined, title: 'Fixture PC', opener: 'host-container-pc-a'}));
  assert.strictEqual(e.document.getElementById('streamProfileTitle').textContent, 'PC profile — Fixture PC');
  e.menu.view.down(); e.menu.view.down(); e.menu.view.right();
  for (let i = 0; i < 4; i++) e.menu.view.down();
  e.document.getElementById('sp-save').click();
  assert.deepStrictEqual(stored(e).hosts['pc-a'].host, {bitrate: 30});
  assert.strictEqual(e.focused.at(-1), 'host-container-pc-a');
}

// A failed write keeps the popup open and says so.
{
  const e = env({failWrites: true});
  e.menu.open(request());
  e.menu.view.right();
  for (let i = 0; i < 6; i++) e.menu.view.down();
  e.document.getElementById('sp-save').click();
  assert(e.document.getElementById('streamProfileDialog').open);
  assert(e.document.getElementById('sp-status').textContent.includes('Could not save the profile'));
  assert.deepStrictEqual(e.notices, []);
}

// The popup does not open during a stream, over another dialog or while hidden;
// hiding the app closes it without saving.
{
  for (const options of [{inGame: true}, {dialogOpen: true}, {hidden: true}]) {
    const e = env(options);
    e.menu.open(request());
    assert.strictEqual(e.document.getElementById('streamProfileDialog'), null, JSON.stringify(options));
    assert.strictEqual(e.nav.changes, 0);
  }
  const e = env();
  e.menu.open(request());
  e.menu.view.right();
  e.document.hidden = true; e.document.dispatch('visibilitychange');
  assert(!e.document.getElementById('streamProfileDialog').open);
  assert.strictEqual(e.store.has(KEY), false);
  assert.strictEqual(e.document.listenerCount('visibilitychange'), 0);
}

// Titles are shown as text, never as markup.
{
  const e = env();
  e.menu.open(request({title: '<img src=x onerror=alert(1)>'}));
  const title = e.document.getElementById('streamProfileTitle');
  assert.strictEqual(title.textContent, 'Game profile — <img src=x onerror=alert(1)>');
  assert.strictEqual(title.children.length, 0);
}
// Every text the popup and the profile messages translate exists in the catalog.
{
  const catalogPath = process.env.ML_CATALOG_FOR_TEST || 'wasm/platform/menu-translations.js';
  const catalog = vm.createContext({});
  vm.runInContext(fs.readFileSync(catalogPath, 'utf8'), catalog);
  const known = new Set(vm.runInContext('MenuTranslations', catalog).map(row => row[0]));
  const neutral = text => /^[0-9.]+ ?(p|FPS|Mbps)$/.test(text) || ['4K', 'H.264', 'HEVC', 'AV1'].includes(text);
  const e = env(), seen = new Set();
  e.context.MenuI18n = {text(value) { seen.add(value); return value; }};
  e.menu.open(request());
  const view = e.menu.view;
  for (let row = 0; row < 6; row++) { for (let i = 0; i < 7; i++) view.right(); view.down(); }
  view.up(); view.up(); view.up(); view.up(); view.up(); view.up();
  view.down(); view.down(); view.down(); view.down(); view.right();   // HDR on with the Settings codec H.264
  view.up(); view.right(); view.down();                                 // explicit H.264 with HDR
  e.document.getElementById('sp-save').click();
  const failing = env({failWrites: true});
  failing.context.MenuI18n = e.context.MenuI18n;
  failing.menu.open(request());
  failing.menu.view.right();
  failing.document.getElementById('sp-save').click();
  const saved = env({stored: JSON.stringify({version: 1, hosts: {'pc-a': {games: {7: {bitrate: 20}}}}})});
  saved.context.MenuI18n = e.context.MenuI18n;
  saved.menu.open(request());
  saved.document.getElementById('sp-remove').click();
  const edited = env();
  edited.context.MenuI18n = e.context.MenuI18n;
  edited.menu.open(request({scope: 'host', title: 'PC'}));
  edited.menu.view.right();
  edited.document.getElementById('sp-save').click();
  const missing = [...seen].filter(text => !neutral(text) && !known.has(text));
  assert.deepStrictEqual(missing, [], 'untranslated popup texts: ' + missing.join(' | '));
  assert(seen.size > 20, 'the popup was exercised');
}
console.log('stream_profile_menu_test: compact dialog, controller navigation, 0.5 Mbps steps, save/remove/cancel, HDR rule, failed writes, guards, cleanup and translation coverage PASS');

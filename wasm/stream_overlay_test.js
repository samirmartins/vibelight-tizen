'use strict';
// Real overlay, focus, session and message dispatch with synthetic DOM, TV
// volume API, gamepads and native stop. Not a Tizen or real-TV emulator.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const {fixture} = require('./fixtures/stream-overlay.cjs');
// Menu order: Resume, Volume, Statistics, Shortcuts, Type text, Disconnect, End game on the PC.
const AT = {disconnect: 5, end: 6};

(async () => {
  {
    const f = fixture();
    assert.strictEqual(f.frames.size, 0, 'no frame at load');
    assert.deepStrictEqual(f.calls.suppressed, []);

    f.setPad({});
    assert.strictEqual(f.c.StreamOverlay.open(), true);
    assert.deepStrictEqual(f.calls.suppressed, [1]);
    assert.strictEqual(f.frames.size, 1);
    assert.strictEqual(f.document.getElementById('streamOverlay').hidden, false);
    assert.strictEqual(f.text('streamOverlay-resume-label'), 'Retomar', 'bundled pt-BR label');
    assert.strictEqual(f.text('streamOverlay-resume-meta'), 'Voltar ao jogo');
    assert(f.c.document.getElementById('streamOverlay-resume').className.includes('streamOverlayPrimary'));
    assert(f.c.document.getElementById('streamOverlay-end').className.includes('streamOverlayDanger'));
    assert.strictEqual(f.text('streamOverlay-disconnect-label'), 'Desconectar');
    assert.strictEqual(f.text('streamOverlay-disconnect-meta'), 'Mantém o jogo no PC');
    assert(f.text('streamOverlayHint').includes('Volume: Esquerda/Direita ajusta'));
    assert(f.text('streamOverlayHint').includes('Confirmar alterna o mudo'));
    assert.strictEqual(f.text('streamOverlay-end-label'), 'Encerrar jogo no PC');
    assert.strictEqual(f.text('streamOverlay-end-meta'), 'Fecha o jogo no PC');
    f.step(); // prime the pad without acting on a held button

    // Navigation wraps and repeats without an interval timer.
    f.press({13: true});
    assert.strictEqual(f.c.FocusManager.index(), 1);
    f.release();
    f.press({13: true});
    assert.strictEqual(f.c.FocusManager.index(), 2);
    f.release();
    f.press({15: true});
    f.release();
    assert.strictEqual(f.c.FocusManager.index(), 3, 'right moves when the item has no adjust step');
    f.c.FocusManager.select(2);

    // Statistics uses the native toggle and session-local visibility.
    f.press({0: true});
    f.release();
    assert.strictEqual(f.calls.toggleStats, 1);
    f.c.statsVisible = true;
    f.c.StreamOverlay.refresh();
    assert.strictEqual(f.text('streamOverlay-stats-label'), 'Estatísticas: ativadas');

    // Volume step comes from the overlay config and mute is visible.
    f.c.FocusManager.select(1);
    f.press({15: true});
    f.release();
    assert.strictEqual(f.c.tizen.tvaudiocontrol.volume, 35);
    f.press({0: true});
    f.release();
    assert.strictEqual(f.c.tizen.tvaudiocontrol.muted, true);
    assert.strictEqual(f.text('streamOverlay-volume-label'), 'Volume: mudo');
    f.press({0: true});
    f.release();
    assert.strictEqual(f.c.tizen.tvaudiocontrol.muted, false);

    // Some TV firmware keeps reporting the old mute state after setMute.
    {
      const f = fixture();
      f.setPad({});
      f.c.StreamOverlay.open();
      f.step();
      f.c.tizen.tvaudiocontrol.getMute = () => false;
      f.c.FocusManager.select(1);
      f.press({0: true});
      f.release();
      assert.strictEqual(f.c.tizen.tvaudiocontrol.muted, true, 'first Confirm mutes');
      assert.strictEqual(f.text('streamOverlay-volume-label'), 'Volume: mudo');
      f.press({0: true});
      f.release();
      assert.strictEqual(f.c.tizen.tvaudiocontrol.muted, false, 'second Confirm unmutes despite stale getMute');
      assert.strictEqual(f.text('streamOverlay-volume-label'), 'Volume: 30%');
      f.c.StreamOverlay.close(true);
    }

    // Closing keeps the mask until the pad is neutral, then stops the frame loop.
    f.c.FocusManager.select(0);
    f.press({0: true});
    assert.strictEqual(f.document.getElementById('streamOverlay').hidden, true);
    assert.deepStrictEqual(f.calls.suppressed, [1], 'mask held while A is still down');
    assert.strictEqual(f.frames.size, 1, 'only the release gate keeps running');
    f.release();
    assert.deepStrictEqual(f.calls.suppressed, [1, 0]);
    assert.strictEqual(f.frames.size, 0);
    assert.strictEqual(f.timers.size, 0);
    assert(f.document.getElementById('wasm_module').focused > 0, 'keyboard focus returns to the stream canvas');
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.press({16: true}); // Guide opens/closes through the native signal in messages.js
    f.release();
    assert.strictEqual(f.c.StreamOverlay.isOpen(), false);
    assert.deepStrictEqual(f.calls.suppressed, [1, 0]);
    assert.strictEqual(f.frames.size, 0);
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.press({8: true, 9: true});
    f.release();
    assert.strictEqual(f.c.StreamOverlay.isOpen(), true, 'Start+Select no longer closes the menu');
    f.press({16: true});
    f.release();
    assert.strictEqual(f.c.StreamOverlay.isOpen(), false, 'Guide closes the menu');
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.c.FocusManager.select(AT.disconnect);
    f.press({0: true});
    assert.strictEqual(f.calls.stop, 1, 'one native stop');
    assert.strictEqual(f.c.StreamOverlay.isOpen(), false);
    assert.strictEqual(f.document.getElementById('streamOverlay').hidden, true);
    assert.strictEqual(f.frames.size, 0, 'no frame loop during teardown');
    assert.deepStrictEqual(f.calls.suppressed, [1], 'teardown keeps the mask');
    f.c.StreamSession.terminated();
    assert.deepStrictEqual(f.calls.suppressed, [1, 0]);
    assert.strictEqual(f.frames.size, 0);
    assert.strictEqual(f.timers.size, 0);
    assert.strictEqual(f.c.StreamSession.isPending(), false);
    // A second click cannot stop twice.
    assert.strictEqual(f.c.StreamSession.disconnect(), true);
    assert.strictEqual(f.calls.stop, 2);
    f.c.StreamSession.terminated();
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.c.FocusManager.select(AT.end);
    f.press({0: true});
    f.release();
    assert.strictEqual(f.document.getElementById('streamOverlayConfirm').hidden, false);
    assert.strictEqual(f.c.FocusManager.count(), 2);
    assert.strictEqual(f.c.FocusManager.index(), 1, 'No is the safe default');
    f.press({1: true}); // B cancels the confirmation
    f.release();
    assert.strictEqual(f.document.getElementById('streamOverlayConfirm').hidden, true);
    assert.strictEqual(f.c.FocusManager.index(), AT.end);
    f.press({0: true});
    f.release();
    f.press({12: true}); // Up from No to Yes
    f.release();
    f.press({0: true}); // Yes
    f.release();
    assert.strictEqual(f.calls.quit, 1);
    assert.strictEqual(f.calls.stop, 0);
    assert.strictEqual(f.c.StreamSession.isPending(), true);
    f.deferred.resolve('xml');
    await f.flush();
    assert.strictEqual(f.calls.stop, 1);
    assert.strictEqual(f.c.StreamOverlay.isOpen(), false);
    f.c.StreamSession.terminated();
    assert.strictEqual(f.calls.suppressed[f.calls.suppressed.length - 1], 0);
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.c.FocusManager.select(AT.end);
    f.press({0: true});
    f.release();
    f.press({12: true});
    f.release();
    f.press({0: true});
    f.release();
    f.deferred.reject(new Error('host refused'));
    await f.flush();
    assert.strictEqual(f.calls.stop, 0, 'the stream survives a failed host request');
    assert.strictEqual(f.c.StreamOverlay.isOpen(), true);
    assert.strictEqual(f.document.getElementById('streamOverlayStatus').textContent,
      'Não foi possível encerrar o jogo no PC.');
    assert.strictEqual(f.c.StreamSession.isPending(), false);
    f.c.StreamOverlay.close(true);
    assert.deepStrictEqual(f.calls.suppressed, [1, 0]);
  }

  { // Busy end-on-PC still exposes local Disconnect to controller input.
    const f = fixture();let cancelled=0;f.deferred.promise.cancel=()=>cancelled++;
    f.setPad({});f.c.StreamOverlay.open();f.step();f.c.FocusManager.select(AT.end);
    f.press({0:true});f.release();f.press({12:true});f.release();f.press({0:true});f.release();
    assert(f.c.StreamSession.isPending());assert(!f.document.getElementById('streamOverlayActions').hidden);
    assert.equal(f.text('streamOverlay-disconnect-meta'),'O encerramento no PC pode continuar.');
    assert.equal(f.c.FocusManager.current().id,'streamOverlay-disconnect');
    f.press({0:true});assert.equal(f.calls.stop,1);assert.equal(cancelled,1);
    f.deferred.resolve();await f.flush();assert.equal(f.calls.stop,1);
    f.c.StreamSession.terminated();
    f.c.StreamOverlay.open();assert(!f.document.getElementById('streamOverlay-resume').disabled);
    f.c.StreamOverlay.close(true);
  }

  {
    const f = fixture({stored: '{broken'});
    f.setPad({});
    assert.strictEqual(f.c.StreamOverlay.open(), true, 'a malformed config falls back to defaults');
    assert.strictEqual(f.c.StreamOverlay.config().volumeStep, 5);
    f.c.StreamOverlay.close(true);
    assert.strictEqual(f.c.StreamOverlay.configure({volumeStep: 0}).volumeStep, 1);
    assert.strictEqual(f.c.StreamOverlay.configure({volumeStep: 99}).volumeStep, 20);
    assert.strictEqual(JSON.parse(f.store.get('vibelight.stream-overlay.v1')).volumeStep, 20);
  }

  {
    const f = fixture();
    f.setPad({});
    f.c.StreamOverlay.open();
    f.step();
    f.document.hidden = true;
    assert(f.listeners.visibilitychange && f.listeners.visibilitychange.length === 1);
    f.listeners.visibilitychange.forEach(handler => handler());
    assert.strictEqual(f.document.getElementById('streamOverlay').hidden, true);
    assert.strictEqual(f.frames.size, 0);
    assert.strictEqual(f.calls.suppressed[f.calls.suppressed.length - 1], 0);
  }

  {
    // Nintendo reports physical A on button 0 and B on button 1.
    const f = fixture();
    f.c.ControllerIdentity = {familyAt: () => 'nintendo'};
    f.setPad({});
    assert.strictEqual(f.c.StreamOverlay.open(), true);
    f.step();
    f.c.FocusManager.select(1);
    f.press({0: true});
    assert.strictEqual(f.c.tizen.tvaudiocontrol.muted, true, 'physical A activates the selected action');
    assert.strictEqual(f.c.StreamOverlay.isOpen(), true);
    f.release();
    f.press({1: true});
    f.release();
    assert.strictEqual(f.c.StreamOverlay.isOpen(), false, 'physical B closes the menu');
    assert.deepStrictEqual(f.calls.suppressed, [1, 0]);
  }

  const source = fs.readFileSync('wasm/platform/stream-overlay.js', 'utf8');
  assert(!/setInterval/.test(source), 'no interval while streaming');
  assert(!/requestAnimationFrame/.test(source.split('function startFrames')[0]), 'no frame loop before the menu opens');
  const indexSource = fs.readFileSync('wasm/platform/index.js', 'utf8');
  const showAppsMode = indexSource.slice(
    indexSource.indexOf('function showAppsMode()'), indexSource.indexOf('// Show the Apps grid'));
  assert(showAppsMode.includes('StreamOverlay.close(true)'), 'every menu return closes the overlay');
  assert(showAppsMode.includes('StreamSession.reset()'), 'every menu return clears a pending stop');
  assert(showAppsMode.includes('ControllerIdentity.refreshPlayers()'), 'every menu return refreshes the player badge');

  // Thin message dispatch: the native signals are the only entry points.
  {
    const calls = {toggled: 0, lost: [], found: [], terminated: 0};
    const c = {
      console: {log() {}, warn() {}, error() {}},
      Promise, JSON, parseInt, Object, Math, Number, String,
      isInGame: true, isDialogOpen: false,
      document: {hidden: false},
      SessionDiagnostics: {finish() {}, sample() {}, note() {}, connected() {},isVisible(){return false;}},
      stopVideoPresentationObserver() {}, stopAudioScheduler() {},
      snackbarLogLong() {}, warningDialog() {},
      $() { return {css() { return this; }, removeClass() { return this; }, addClass() { return this; }, prop() { return false; }}; },
      showApps() { calls.showApps = (calls.showApps || 0) + 1; },
      StreamOverlay: {
        toggle() { calls.toggled++; }
      },
      StreamSession: {terminated() { calls.terminated++; }},
      setTimeout() { return 1; },
      api: {},
      AppLifecycle: undefined
    };
    c.window = c;
    vm.createContext(c);
    vm.runInContext(fs.readFileSync('wasm/platform/messages.js', 'utf8'), c);
    c.handleMessage('guideButton');
    c.StreamStartup = {active() { return true; }, finish() {}};
    c.handleMessage('guideButton');
    assert.strictEqual(calls.toggled, 1, 'Guide cannot stack the game menu over connection progress');
    delete c.StreamStartup;
    c.handleMessage('controllerLost: 2');
    c.handleMessage('controllerFound: 2');
    c.handleMessage('streamTerminated: 0');
    assert.strictEqual(calls.toggled, 1);
    assert.strictEqual(typeof c.StreamOverlay.controllerLost, 'undefined',
      'the lost-controller notice is gone');
    assert.strictEqual(calls.terminated, 1);
    assert.strictEqual(calls.showApps, 1, 'the termination handler still owns the single return');
    c.isInGame = false;
    c.handleMessage('guideButton');
    assert.strictEqual(calls.toggled, 1, 'Guide is inert outside a stream');
  }

  console.log('stream_overlay_test: atomic mask, Guide-only, pt-BR labels, navigation, volume, stats, disconnect, confirmed end-on-PC, styled action cards, config and message dispatch PASS (synthetic inputs)');
})().catch(error => { console.error(error); process.exitCode = 1; });

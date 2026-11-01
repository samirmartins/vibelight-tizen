// Menu-only ambient dimming. One idle timer runs while the menu is active; it
// is cleared before streaming, so gameplay never gets an extra display layer.
var AmbientMode = (function() {
  var KEY = 'vibelight.screensaver.v1';
  var DEFAULT_MINUTES = 5;
  var MINUTES = [0, 1, 5, 10];
  var minutes = load();
  var active = false;
  var timer = 0;
  var root = null;
  var dimmed = false;
  var lastActivityAt = 0;
  var lastPointerX = null, lastPointerY = null;
  var axisWake = Object.create(null);

  function load() {
    try {
      var value = parseInt(localStorage.getItem(KEY), 10);
      if (MINUTES.indexOf(value) !== -1) return value;
    } catch (e) {}
    return DEFAULT_MINUTES;
  }

  function save() {
    try { localStorage.setItem(KEY, String(minutes)); } catch (e) {}
  }

  function menuRunning() {
    return typeof Navigation === 'undefined' ||
      typeof Navigation.isRunning !== 'function' || Navigation.isRunning();
  }

  function allowed() {
    return active && minutes > 0 &&
      !(typeof isInGame !== 'undefined' && isInGame) &&
      !(typeof document !== 'undefined' && document.hidden) &&
      menuRunning();
  }

  function label(value) {
    if (value === 0) return 'Off';
    if (value === 1) return '1 minute';
    return value + ' minutes';
  }

  function translate(value) {
    return typeof MenuI18n !== 'undefined' && typeof MenuI18n.text === 'function'
      ? MenuI18n.text(value) : value;
  }

  function syncSelect() {
    var button = document.getElementById('selectScreensaver');
    if (!button) return;
    button.setAttribute('data-value', String(minutes));
    var text = translate(label(minutes));
    if (button.textContent !== text) button.textContent = text;
  }

  function syncViewIndex(view) {
    if (!view || !view.view) return;
    var index = MINUTES.indexOf(minutes);
    if (index >= 0) view.view.index = index;
  }

  function createOverlay() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'ambientOverlay';
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(root);
    return root;
  }

  function show() {
    if (dimmed) return;
    createOverlay();
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    // Apply the visible class in the same task: an idle TV must not depend on
    // requestAnimationFrame to darken the menu. Forcing layout keeps the fade.
    void root.offsetWidth;
    root.classList.add('ambient-visible');
    dimmed = true;
    // Re-arm stick edges so a held stick that moves after dimming wakes it.
    axisWake = Object.create(null);
  }

  function hide() {
    if (root) {
      root.classList.remove('ambient-visible');
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
    }
    dimmed = false;
  }

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
  }

  function schedule() {
    clearTimer();
    if (!allowed()) return;
    timer = setTimeout(check, minutes * 60000);
  }

  function check() {
    timer = 0;
    if (!allowed()) {
      hide();
      return;
    }
    if ((typeof isDialogOpen !== 'undefined' && isDialogOpen) ||
        (typeof document.querySelector === 'function' && document.querySelector('dialog[open]'))) {
      schedule();
      return;
    }
    show();
  }

  function resetTimer() {
    schedule();
  }

  function wake(event) {
    if (dimmed) {
      hide();
      if (event) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      }
    }
    resetTimer();
  }

  function onKeyDown(event) {
    if (!active || (typeof isInGame !== 'undefined' && isInGame)) return;
    wake(event);
  }

  function onPointer(event) {
    if (!active || (typeof isInGame !== 'undefined' && isInGame)) return;
    wake(event);
  }

  function onMove(event) {
    if (!active || (typeof isInGame !== 'undefined' && isInGame)) return;
    var x = event && typeof event.clientX === 'number' ? event.clientX : null;
    var y = event && typeof event.clientY === 'number' ? event.clientY : null;
    // Some TV engines emit mousemove continuously at the same coordinates.
    // Only a real pointer displacement counts as activity.
    if (x === null || y === null) return;
    if (lastPointerX !== null &&
        Math.abs(x - lastPointerX) < 2 && Math.abs(y - lastPointerY) < 2) return;
    lastPointerX = x; lastPointerY = y;
    var now = typeof performance !== 'undefined' && performance.now
      ? performance.now() : Date.now();
    if (dimmed) {
      wake(event);
    } else if (now - lastActivityAt >= 1000) {
      lastActivityAt = now;
      resetTimer();
    }
  }

  function meaningfulGamepad(detail) {
    var changes = detail && detail.changes ? detail.changes : [];
    var pad = detail && detail.padIndex !== undefined ? detail.padIndex : 0;
    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      if (change.type === 'button') {
        if (change.pressed) return true;
        continue;
      }
      // Ignore triggers and other non-stick axes. A trigger resting at -1 or
      // a noisy axis must not keep the idle timer alive.
      if (change.type !== 'axis' || change.index < 0 || change.index > 3) continue;
      var key = pad + ':' + change.index;
      var value = Math.abs(Number(change.value));
      value = isFinite(value) ? value : 0;
      if (value >= 0.65 && !axisWake[key]) {
        axisWake[key] = true;
        return true;
      }
      if (value < 0.2) axisWake[key] = false;
    }
    return false;
  }

  function onGamepad(event) {
    if (!active || (typeof isInGame !== 'undefined' && isInGame)) return;
    if (!event || !event.detail) return;
    if (!meaningfulGamepad(event.detail)) return;
    wake(event);
  }

  function setMinutes(value) {
    value = parseInt(value, 10);
    if (MINUTES.indexOf(value) === -1) value = DEFAULT_MINUTES;
    minutes = value;
    save();
    syncSelect();
    if (dimmed) hide();
    schedule();
  }

  function start() {
    active = true;
    syncSelect();
    resetTimer();
  }

  function stop() {
    active = false;
    clearTimer();
    hide();
  }

  function reset() {
    setMinutes(DEFAULT_MINUTES);
  }

  function onSelectClick(event) {
    var item = event && event.target;
    while (item && item !== document.body && !(item.classList && item.classList.contains('mdl-menu__item'))) {
      item = item.parentNode;
    }
    if (!item || !item.getAttribute) return;
    var value = item.getAttribute('data-value');
    if (value === null) return;
    setMinutes(value);
  }

  function registerSelect() {
    var button = document.getElementById('selectScreensaver');
    if (!button) return;
    button.addEventListener('click', function() {
      if (typeof Navigation === 'undefined' || typeof Views === 'undefined' ||
          !Views.SelectScreensaverMenu) return;
      var view = Views.SelectScreensaverMenu;
      if (view.isActive()) { Navigation.pop(); return; }
      syncViewIndex(view);
      Navigation.push(view);
    });
    var option = button.closest ? button.closest('.setting-option') : null;
    var menu = option && option.querySelector ? option.querySelector('.mdl-menu') : null;
    if (menu) menu.addEventListener('click', onSelectClick);
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('mousedown', onPointer, true);
  window.addEventListener('wheel', onPointer, true);
  window.addEventListener('touchstart', onPointer, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('gamepadinputchanged', onGamepad, true);
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) stop();
    else if (typeof Navigation === 'undefined' || menuRunning()) start();
  });

  window.addEventListener('load', function() {
    syncSelect();
    registerSelect();
    var restore = document.getElementById('continueRestoreDefaults');
    if (restore) restore.addEventListener('click', reset);
    start();
  });
  syncSelect();
  start();

  return {
    start: start,
    stop: stop,
    setMinutes: setMinutes,
    getMinutes: function() { return minutes; },
    isDimmed: function() { return dimmed; },
    reset: reset,
    sync: syncSelect
  };
})();

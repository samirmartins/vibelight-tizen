// Minimal per-family controller mapping editor. The overlay and test listener
// exist only while the dialog is open.
var ControllerMappingMenu = (function() {
  var families = ['xbox', 'playstation', 'nintendo'];
  var profiles = {
    xbox: {
      name: 'Xbox', image: 'static/res/controller-xbox.png',
      source: ['A','B','X','Y','LB','RB','LT','RT','View','Menu','LS','RS','↑','↓','←','→','Guide','Share','Mute'],
      target: ['A','B','X','Y','LB','RB','LT','RT','View','Menu','LS','RS','↑','↓','←','→','Guide']
    },
    playstation: {
      name: 'PlayStation', image: 'static/res/controller-ps5.png',
      source: ['Cross','Circle','Square','Triangle','L1','R1','L2','R2','Create','Options','L3','R3','↑','↓','←','→','PS','Touchpad','Mute'],
      target: ['Cross','Circle','Square','Triangle','L1','R1','L2','R2','Create','Options','L3','R3','↑','↓','←','→','PS']
    },
    nintendo: {
      name: 'Switch', image: 'static/res/controller-switch.png',
      source: ['B','A','Y','X','L','R','ZL','ZR','Minus','Plus','L3','R3','↑','↓','←','→','Home','Capture','Mute'],
      target: ['B','A','Y','X','L','R','ZL','ZR','Minus','Plus','L3','R3','↑','↓','←','→','Home']
    }
  };
  var root, dialog, draft, tuning, family = 'xbox', selected = 0, choosing = false, testing = false;
  var focused = 'cm-family-xbox', statusText = '', testInput = null;

  function el(id) { return document.getElementById(id); }
  function translate(value) {
    return typeof MenuI18n !== 'undefined' && typeof MenuI18n.text === 'function'
      ? MenuI18n.text(value) : value;
  }
  function profile() { return draft.profiles[family]; }
  function source(i) { return profiles[family].source[i]; }
  function target(i) { return profiles[family].target[i]; }
  function sourceText(i) { return translate(source(i)); }
  function targetText(i) { return translate(target(i)); }
  function faceText(value) {
    if (family === 'playstation' && value === 'Cross') return '✕';
    if (family === 'playstation' && value === 'Circle') return '○';
    if (family === 'playstation' && value === 'Square') return '□';
    if (family === 'playstation' && value === 'Triangle') return '△';
    return value;
  }
  function setStatus(text) { statusText = text || ''; if (el('cm-status')) el('cm-status').textContent = translate(statusText); }
  function focus(id) {
    var node = el(id);
    if (node && !node.disabled) { focused = id; node.focus(); if (node.scrollIntoView) node.scrollIntoView({block:'nearest'}); }
  }
  function controls() {
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll('button')).filter(function(node) {
      return !node.disabled && !node.hidden && node.getClientRects().length;
    });
  }
  function move(dx, dy) {
    var current = el(focused), items = controls();
    if (!current || !items.includes(current)) { if (items.length) focus(items[0].id); return; }
    var from = current.getBoundingClientRect(), best = null, distance = Infinity;
    items.forEach(function(node) {
      if (node === current) return;
      var r = node.getBoundingClientRect(), x = (r.left+r.right-from.left-from.right)/2;
      var y = (r.top+r.bottom-from.top-from.bottom)/2;
      if ((dx && dx*x <= 1) || (dy && dy*y <= 1)) return;
      var score = dx ? Math.abs(x)+Math.abs(y)*3 : Math.abs(y)+Math.abs(x)*3;
      if (score < distance) { distance = score; best = node; }
    });
    if (best) focus(best.id);
  }
  var view = {
    enter:function() { focus(focused); }, leave:function() {},
    up:function() { move(0,-1); }, down:function() { move(0,1); },
    left:function() { move(-1,0); }, right:function() { move(1,0); },
    accept:function() { var node = el(focused); if (node && !node.disabled) node.click(); },
    back:function() {
      if (choosing) { choosing = false; render(); focus('cm-change'); return; }
      if (!el('cm-analog-panel').hidden) { el('cm-analog-panel').hidden = true; focus('cm-analog-row'); return; }
      close();
    },
    press:function() {}, switch:function() { focus(focused); }
  };
  var curveNames = {1:'Linear', 0.75:'Soft', 1.5:'Precise', 2:'Strong'};
  var invertNames = ['OFF', 'X', 'Y', 'X+Y'];
  function cycle(list, value) {
    var index = list.indexOf(value);
    return list[(index + 1) % list.length];
  }
  function percent(value) { return Math.round(value * 100) + '%'; }
  function renderTuning() {
    if (!tuning) return;
    el('cm-tuning-enabled').textContent = translate('Analog tuning') + ': ' + translate(tuning.enabled ? 'ON' : 'OFF');
    el('cm-deadzone').textContent = translate('Deadzone') + ': ' + (tuning.deadzone ? percent(tuning.deadzone) : translate('none'));
    el('cm-curve').textContent = translate('Curve') + ': ' + translate(curveNames[tuning.curve] || 'Linear');
    el('cm-invert-left').textContent = translate('Invert left') + ': ' + translate(invertNames[tuning.invertLeft]);
    el('cm-invert-right').textContent = translate('Invert right') + ': ' + translate(invertNames[tuning.invertRight]);
    el('cm-swap-sticks').textContent = translate('Swap sticks') + ': ' + translate(tuning.swapSticks ? 'ON' : 'OFF');
    el('cm-trigger-threshold').textContent = translate('Trigger threshold') + ': ' +
      (tuning.triggerThreshold ? percent(tuning.triggerThreshold) : translate('none'));
    var disabled = !tuning.enabled || testing;
    ['cm-deadzone','cm-curve','cm-invert-left','cm-invert-right','cm-swap-sticks',
      'cm-trigger-threshold'].forEach(function(id) { el(id).disabled = disabled; });
    el('cm-tuning-enabled').disabled = testing;
    el('cm-analog-state').textContent = translate(tuning.enabled ? 'Enabled' : 'Disabled');
  }
  function renderKeys() {
    var box = el('cm-key-grid');
    box.textContent = '';
    for (var i = 0; i < 16; i++) {
      var key = document.createElement('button');
      key.type = 'button'; key.id = 'cm-key-' + i;
      key.className = 'cm-key' + (selected === i ? ' cm-selected' : '') + (testing ? ' cm-testing' : '');
      key.textContent = faceText(sourceText(i));
      key.setAttribute('aria-label', sourceText(i));
      key.onclick = (function(index) { return function() { selected = index; render(); focus('cm-key-' + index); }; })(i);
      box.appendChild(key);
    }
  }
  function pairText(i) {
    var s = sourceText(i), t = targetText(profile().map[i]);
    if (s === t) return '';
    return profile().map[profile().map[i]] === i ? s + ' ↔ ' + t : s + ' → ' + t;
  }
  function renderChanges() {
    var box = el('cm-changes'); box.textContent = '';
    var seen = Object.create(null), found = false;
    for (var i=0; i<16; i++) {
      var s = sourceText(i), t = targetText(profile().map[i]);
      if (s === t) continue;
      var key = [s,t].sort().join('|');
      if (seen[key]) continue;
      seen[key] = true; found = true;
      var chip = document.createElement('span'); chip.className = 'cm-chip';
      var pair = [s, t].sort();
      chip.textContent = profile().map[profile().map[i]] === i ? pair[0] + ' ↔ ' + pair[1] : s + ' → ' + t;
      box.appendChild(chip);
    }
    if (!found) { var chip = document.createElement('span'); chip.className = 'cm-chip'; chip.textContent = translate('No swaps'); box.appendChild(chip); }
  }
  function renderTargets() {
    var box = el('cm-targets'); box.textContent = '';
    var sourceIsTrigger = selected === 6 || selected === 7;
    for (var i=0; i<16; i++) {
      if ((i === 6 || i === 7) !== sourceIsTrigger) continue;
      var button = document.createElement('button'); button.type = 'button';
      button.id = 'cm-target-' + i; button.className = 'cm-target' + (profile().map[selected] === i ? ' cm-selected' : '');
      button.textContent = targetText(i);
      button.onclick = function(index) { return function() {
        ControllerMapping.assign(draft, family, selected, index);
        choosing = false; render(); focus('cm-change');
        setStatus('Assignment swapped. Save to keep this layout.');
      }; }(i);
      box.appendChild(button);
    }
  }
  function render() {
    if (!draft) return;
    el('cm-family-xbox').classList.toggle('cm-active', family === 'xbox');
    el('cm-family-playstation').classList.toggle('cm-active', family === 'playstation');
    el('cm-family-nintendo').classList.toggle('cm-active', family === 'nintendo');
    el('cm-profile-title').textContent = profiles[family].name;
    el('cm-art').src = profiles[family].image;
    el('cm-art').alt = profiles[family].name;
    renderKeys();
    el('cm-selected').textContent = sourceText(selected);
    el('cm-selected-detail').textContent = profiles[family].name + ' · ' + translate('Physical button');
    el('cm-face').textContent = faceText(source(selected));
    el('cm-face').className = 'cm-face cm-face-' + family;
    var s = sourceText(selected), t = targetText(profile().map[selected]);
    el('cm-target-value').textContent = s === t ? t : pairText(selected);
    el('cm-target-note').textContent = s === t ? translate('Original') : translate('Swapped');
    el('cm-change').disabled = testing;
    el('cm-test').textContent = translate(testing ? 'Stop test' : 'Test buttons');
    el('cm-analog-row').disabled = testing;
    el('cm-analog-toggle').textContent = el('cm-analog-panel').hidden ? '›' : '⌄';
    el('cm-inspector-main').hidden = choosing;
    el('cm-choice').hidden = !choosing;
    if (choosing) renderTargets();
    renderChanges(); renderTuning();
    el('cm-status').textContent = translate(statusText);
  }
  function ensure() {
    if (root) return;
    root = document.createElement('div'); root.className = 'cm-overlay'; root.style.display = 'none';
    root.innerHTML =
      '<dialog id="controllerMappingDialog" aria-labelledby="cm-title">'+
      '<header class="cm-header"><div><div class="cm-eyebrow" id="cm-eyebrow">CONTROLES</div>'+
      '<h2 id="cm-title">Controller mapping</h2><p class="cm-sub">Game controls only. Menu navigation stays unchanged.</p></div>'+
      '<div class="cm-tabs"><button type="button" id="cm-family-xbox" class="cm-tab"><span></span>Xbox</button>'+
      '<button type="button" id="cm-family-playstation" class="cm-tab"><span></span>PlayStation</button>'+
      '<button type="button" id="cm-family-nintendo" class="cm-tab"><span></span>Switch</button></div></header>'+
      '<p id="cm-status" role="status"></p>'+
      '<div class="cm-body"><section class="cm-stage"><div class="cm-stage-head"><strong id="cm-profile-title">Xbox</strong>'+
      '<span id="cm-connection">Independent profile</span></div>'+
      '<div class="cm-art-wrap" id="cm-art-wrap"><img id="cm-art" alt=""></div>'+
      '<div id="cm-key-grid" class="cm-key-grid"></div>'+
      '<p class="cm-stage-foot">Click a button or use the direction pad.</p></section>'+
      '<aside class="cm-inspector"><div id="cm-inspector-main">'+
      '<div class="cm-eyebrow" id="cm-selected-label">SELECTED BUTTON</div>'+
      '<div class="cm-sel-card"><div id="cm-face" class="cm-face">A</div><div><h3 id="cm-selected">A</h3>'+
      '<p id="cm-selected-detail">Xbox · Physical button</p></div></div>'+
      '<div class="cm-map-card"><div class="cm-map-row"><div><div class="cm-label" id="cm-target-label">Goes to game</div>'+
      '<div id="cm-target-value" class="cm-value">A</div><div id="cm-target-note" class="cm-note">Original</div></div>'+
      '<button type="button" id="cm-change" class="cm-primary">Change</button></div>'+
      '<div class="cm-map-row cm-map-actions"><button type="button" id="cm-test" class="cm-ghost">Test buttons</button></div></div>'+
      '<div class="cm-changed"><h3 id="cm-changed-title">Changes in this profile</h3><div id="cm-changes" class="cm-chips"></div></div>'+
      '</div><div id="cm-choice" class="cm-choice" hidden><div class="cm-eyebrow">CHOOSE GAME BUTTON</div>'+
      '<p class="cm-note">The other assignment swaps automatically.</p><div id="cm-targets" class="cm-targets"></div>'+
      '<button type="button" id="cm-choice-cancel" class="cm-ghost">Back</button></div></aside></div>'+
      '<button type="button" id="cm-analog-row" class="cm-analog-row"><span id="cm-analog-label">Analog tuning</span>'+
      '<span id="cm-analog-state">Disabled</span><span id="cm-analog-toggle">›</span></button>'+
      '<div id="cm-analog-panel" class="cm-analog-panel" hidden><div class="cm-tuning-grid">'+
      '<button type="button" id="cm-tuning-enabled">Analog tuning: OFF</button><button type="button" id="cm-deadzone">Deadzone: none</button>'+
      '<button type="button" id="cm-curve">Curve: Linear</button><button type="button" id="cm-invert-left">Invert left: OFF</button>'+
      '<button type="button" id="cm-invert-right">Invert right: OFF</button><button type="button" id="cm-swap-sticks">Swap sticks: OFF</button>'+
      '<button type="button" id="cm-trigger-threshold">Trigger threshold: none</button></div>'+
      '<p class="cm-note">Optional response for the next stream. Defaults keep the original sticks and triggers.</p></div>'+
      '<footer class="cm-footer"><button type="button" id="cm-reset" class="cm-ghost">Restore layout</button>'+
      '<div><button type="button" id="cm-cancel" class="cm-ghost">Cancel</button><button type="button" id="cm-save" class="cm-primary">Save</button></div></footer>'+
      '</dialog>';
    document.body.appendChild(root); dialog = el('controllerMappingDialog');
    root.addEventListener('focusin', function(event) { if (event.target.tagName === 'BUTTON') focused = event.target.id; });
    el('cm-family-xbox').onclick = function() { selectFamily('xbox'); };
    el('cm-family-playstation').onclick = function() { selectFamily('playstation'); };
    el('cm-family-nintendo').onclick = function() { selectFamily('nintendo'); };
    el('cm-change').onclick = function() { choosing = true; render(); focus('cm-target-' + profile().map[selected]); };
    el('cm-choice-cancel').onclick = function() { choosing = false; render(); focus('cm-change'); };
    el('cm-test').onclick = function() { if (testing) stopTest(); else startTest(); };
    el('cm-analog-row').onclick = function() {
      el('cm-analog-panel').hidden = !el('cm-analog-panel').hidden;
      render(); if (!el('cm-analog-panel').hidden) focus('cm-tuning-enabled'); else focus('cm-analog-row');
    };
    el('cm-tuning-enabled').onclick = function() { tuning.enabled = !tuning.enabled; renderTuning(); };
    el('cm-deadzone').onclick = function() { tuning.deadzone = cycle(ControllerTuning.DEADZONES, tuning.deadzone); renderTuning(); };
    el('cm-curve').onclick = function() { tuning.curve = cycle(ControllerTuning.CURVES, tuning.curve); renderTuning(); };
    el('cm-invert-left').onclick = function() { tuning.invertLeft = (tuning.invertLeft + 1) % 4; renderTuning(); };
    el('cm-invert-right').onclick = function() { tuning.invertRight = (tuning.invertRight + 1) % 4; renderTuning(); };
    el('cm-swap-sticks').onclick = function() { tuning.swapSticks = !tuning.swapSticks; renderTuning(); };
    el('cm-trigger-threshold').onclick = function() { tuning.triggerThreshold = cycle(ControllerTuning.THRESHOLDS, tuning.triggerThreshold); renderTuning(); };
    el('cm-reset').onclick = function() {
      ControllerMapping.reset(draft, family); tuning = ControllerTuning.defaults();
      render(); setStatus('Original button assignments and analog defaults restored. Save to keep them.');
    };
    el('cm-cancel').onclick = close;
    el('cm-save').onclick = save;
    dialog.addEventListener('keydown', function(event) {
      var direction = {ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
      if (direction) { event.preventDefault(); event.stopPropagation(); move(direction[0],direction[1]); }
    });
    dialog.oncancel = function(event) { event.preventDefault(); view.back(); };
  }
  function selectFamily(next) {
    if (!profiles[next]) return;
    family = next; selected = 1; choosing = false;
    render(); focus('cm-key-1');
  }
  function startTest() {
    if (testing) return;
    if (typeof LibraryNavigation !== 'undefined' && LibraryNavigation.suspend) LibraryNavigation.suspend();
    testing = true; render();
    testInput = function(event) {
      var changes = event && event.detail && event.detail.changes || [];
      changes.forEach(function(change) {
        if (change.type !== 'button' || change.index < 0 || change.index > 15) return;
        var node = el('cm-key-' + change.index);
        if (node) node.classList.toggle('cm-pressed', !!change.pressed);
      });
    };
    window.addEventListener('gamepadinputchanged', testInput, true);
    setStatus('Press buttons to see them light up. Click Stop test when finished.');
    focus('cm-test');
  }
  function stopTest() {
    if (!testing) return;
    testing = false;
    if (testInput) window.removeEventListener('gamepadinputchanged', testInput, true);
    testInput = null;
    if (typeof LibraryNavigation !== 'undefined' && LibraryNavigation.resume) LibraryNavigation.resume();
    for (var i = 0; i < 16; i++) { var node = el('cm-key-' + i); if (node) node.classList.remove('cm-pressed'); }
    render(); setStatus('Test finished. Menu navigation stays on the original layout.');
  }
  function hidden() { if (document.hidden) close(); }
  function close() {
    if (!dialog || !dialog.open) return;
    stopTest();
    document.removeEventListener('visibilitychange', hidden);
    closeUtilityDialog('controllerMappingDialog');
    root.style.display = 'none'; draft = null; tuning = null; testing = false; choosing = false;
    focusElement('controllerMappingBtn');
  }
  function save() {
    if (!ControllerMapping.save(draft)) { setStatus('Could not save. Check storage and try again; your previous layout is unchanged.'); return; }
    if (!ControllerTuning.save(tuning)) { setStatus('Could not save the analog response. Check storage and try again.'); return; }
    var saved = tuning.enabled ? 'Analog tuning saved. It applies to the next stream.' : 'Controller settings saved.';
    close();
    if (typeof snackbarLog === 'function') snackbarLog(translate(saved));
  }
  function open() {
    if (isInGame || isDialogOpen || document.hidden) return;
    ensure();
    family = 'xbox';
    if (typeof ControllerIdentity !== 'undefined') {
      var primary = ControllerIdentity.primaryFamily();
      if (primary === 'playstation' || primary === 'nintendo') family = primary;
    }
    draft = ControllerMapping.get(); tuning = ControllerTuning.get();
    selected = 1; choosing = false; testing = false; statusText = '';
    render();
    setStatus('Select a physical button, then Change. Cancel leaves saved settings unchanged.');
    openUtilityDialog('controllerMappingDialog', ['cm-family-xbox','cm-cancel'], 'cm-cancel');
    document.addEventListener('visibilitychange', hidden);
    Navigation.change(view);
    focus('cm-key-1');
  }
  return {open:open, isTesting:function() { return testing; }};
})();

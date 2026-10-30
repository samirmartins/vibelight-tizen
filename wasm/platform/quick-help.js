// Compact, controller-aware control reference for the menu. It is built only
// when opened and never starts a timer or frame loop.
var QuickHelp = (function() {
  var built = false, open = false;
  var overlay = null, list = null, closeButton = null;

  function translate(value) {
    return typeof MenuI18n !== 'undefined' && typeof MenuI18n.text === 'function'
      ? MenuI18n.text(value) : value;
  }

  function create(tag, id, className) {
    var node = document.createElement(tag);
    if (id) node.id = id;
    if (className) node.className = className;
    return node;
  }

  function addRow(action, key) {
    var row = create('div', null, 'quick-help-row');
    var actionNode = create('span', null, 'quick-help-action');
    var keyNode = create('span', null, 'quick-help-key');
    actionNode.textContent = translate(action);
    keyNode.textContent = key;
    row.appendChild(actionNode);
    row.appendChild(keyNode);
    list.appendChild(row);
  }

  function build() {
    if (built) return;
    overlay = create('div', 'quickHelpOverlay', 'quick-help-overlay');
    overlay.hidden = true;
    var panel = create('div', 'quickHelpPanel', 'quick-help-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'quickHelpTitle');
    var title = create('h2', 'quickHelpTitle', 'quick-help-title');
    title.textContent = translate('Quick help');
    list = create('div', 'quickHelpRows', 'quick-help-rows');
    closeButton = create('button', 'quickHelpClose', 'console-button');
    closeButton.setAttribute('type', 'button');
    closeButton.textContent = translate('Close');
    closeButton.onclick = close;
    panel.appendChild(title);
    panel.appendChild(list);
    panel.appendChild(closeButton);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    built = true;
  }

  function populate() {
    list.textContent = '';
    var family = typeof ControllerIdentity !== 'undefined' ? ControllerIdentity.primaryFamily() : 'unknown';
    var labels = typeof ControllerIdentity !== 'undefined'
      ? ControllerIdentity.labels(family)
      : {accept: 'A', back: 'B', face2: 'X', face3: 'Y', lb: 'LB', rb: 'RB',
         lt: 'LT', rt: 'RT', start: 'Start', guide: 'Guide'};
    addRow('Navigate', translate('D-pad / Left stick'));
    addRow('Accept', labels.accept);
    addRow('Back', labels.back);
    addRow('Library filters', labels.lb + ' / ' + labels.rb);
    addRow('Page the library', labels.lt + ' / ' + labels.rt);
    addRow('Favorite game', labels.face2);
    addRow('Quick help', labels.start);
    addRow('Navigation guide', labels.guide);
    addRow('Close', labels.back);
  }

  var view = {
    up: function() {}, down: function() {}, left: function() {}, right: function() {},
    accept: close,
    back: close,
    press: function() {},
    switch: function() { if (closeButton) focusElement(closeButton); },
    enter: function() {
      if (closeButton) {
        if (typeof mark === 'function') mark(closeButton);
        focusElement(closeButton);
      }
    },
    leave: function() {
      if (closeButton && typeof unmark === 'function') unmark(closeButton);
    }
  };

  function openHelp() {
    if (typeof isInGame !== 'undefined' && isInGame) return false;
    if (typeof isDialogOpen !== 'undefined' && isDialogOpen) return false;
    if (document.hidden) return false;
    build();
    populate();
    overlay.hidden = false;
    open = true;
    isDialogOpen = true;
    Navigation.push(view);
    return true;
  }

  function close() {
    if (!open) return false;
    open = false;
    overlay.hidden = true;
    isDialogOpen = false;
    Navigation.pop();
    return true;
  }

  function toggle() {
    return open ? close() : openHelp();
  }

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) close();
  });

  return {
    open: openHelp,
    close: close,
    toggle: toggle,
    isOpen: function() { return open; }
  };
})();

// The frame rate menu with the experimental 120 FPS option. It uses only DOM methods so it can be
// tested on a small DOM; the page passes the value access (the settings keep it with jQuery data).
// 120 FPS is listed, with the same Experimental badge as the audio options, only while the panel
// is measured near 120 Hz (HighRefresh.supported); a 120 selection the panel cannot show returns to 60.
var HighRefreshMenu = (function() {
  'use strict';

  function itemFor(menu, rate) {
    var items = menu && menu.children ? menu.children : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute && items[i].getAttribute('data-value') === rate) return items[i];
    }
    return null;
  }
  function span(document, className, text) {
    var node = document.createElement('span');
    node.className = className;
    node.textContent = text;
    return node;
  }
  function build(document) {
    var item = document.createElement('li');
    item.classList.add('mdl-menu__item');
    item.setAttribute('data-value', HighRefresh.RATE);
    item.appendChild(span(document, 'framerate-option-label', HighRefresh.RATE + ' FPS '));
    item.appendChild(span(document, 'badge badge-experimental', 'Experimental'));
    return item;
  }

  // Shows an option in the selected-value button: a plain option as text, a labelled one as label
  // plus its badge (the audio menu does the same).
  function render(button, item) {
    if (!button || !item || !item.children) return;
    var label = null, badge = null, i;
    for (i = 0; i < item.children.length; i++) {
      var child = item.children[i];
      if (child.className === 'framerate-option-label') label = child;
      else if (child.classList && child.classList.contains('badge')) badge = child;
    }
    if (!label) { button.textContent = item.textContent; return; }
    var doc = button.ownerDocument || item.document;
    button.textContent = '';
    button.appendChild(span(doc, label.className, String(label.textContent).trim()));
    if (badge) button.appendChild(span(doc, badge.className, badge.textContent));
  }

  // options: {document, menu, button, x100, stored, value(), choose(rate), onReset()}
  function sync(options) {
    try {
      if (!options || !options.document || !options.menu || !options.button) return;
      var menu = options.menu, current = String(options.value()), existing = itemFor(menu, HighRefresh.RATE);
      if (HighRefresh.supported(options.x100)) {
        if (!existing) { existing = build(options.document); menu.appendChild(existing); }
        // A stored 120 returns once the panel is known to show it (the caller passes it only until then).
        if (String(options.stored) === HighRefresh.RATE && current !== HighRefresh.RATE && current === '60') {
          options.choose(HighRefresh.RATE);
          render(options.button, existing);
        }
        return;
      }
      if (existing) menu.removeChild(existing);
      if (current === HighRefresh.RATE) {
        options.choose('60');
        render(options.button, itemFor(menu, '60'));
        if (typeof options.onReset === 'function') options.onReset();
      }
    } catch (e) { /* the menu keeps working without the experimental option */ }
  }

  return { sync: sync, render: render, build: build };
})();

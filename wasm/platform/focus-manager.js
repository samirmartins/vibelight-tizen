// Focus for one self-contained list at a time. Menu navigation keeps its own
// stack; this helper is for surfaces that own their input, such as the stream
// overlay. It never starts timers or listeners.
var FocusManager = (function() {
  var items = [], index = -1;

  function usable(element) {
    return !!(element && element.classList && typeof element.classList.add === 'function');
  }

  function paint() {
    for (var i = 0; i < items.length; i++) {
      if (i === index) items[i].classList.add('hovered');
      else items[i].classList.remove('hovered');
    }
    var current = items[index];
    if (current && typeof focusElement === 'function') focusElement(current);
  }

  function close() {
    if (index < 0) return;
    var previous = items[index];
    for (var i = 0; i < items.length; i++) items[i].classList.remove('hovered');
    items = [];
    index = -1;
    if (previous && typeof blurElement === 'function') blurElement(previous);
  }

  function open(list, start) {
    close();
    var source = Array.prototype.slice.call(list || []);
    for (var i = 0; i < source.length; i++) {
      if (usable(source[i])) items.push(source[i]);
    }
    if (!items.length) return false;
    index = typeof start === 'number' && start >= 0 && start < items.length ? start : 0;
    paint();
    return true;
  }

  function move(delta) {
    if (index < 0 || !items.length || !delta) return false;
    var next = (index + delta) % items.length;
    if (next < 0) next += items.length;
    if (next === index) return false;
    index = next;
    paint();
    return true;
  }

  function select(position) {
    if (index < 0 || !items.length) return false;
    if (typeof position !== 'number' || position < 0 || position >= items.length) return false;
    index = position;
    paint();
    return true;
  }

  return {
    open: open,
    close: close,
    move: move,
    select: select,
    current: function() { return index >= 0 ? items[index] : null; },
    count: function() { return items.length; },
    active: function() { return index >= 0; },
    index: function() { return index; }
  };
})();

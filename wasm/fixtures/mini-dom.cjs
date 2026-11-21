'use strict';
// A small DOM for menu tests: elements, text, classes, focus, click, dialogs and
// document events. No layout, no CSS: only what the menus use.
class MiniClassList {
  constructor(owner) { this.owner = owner; this.set = new Set(); }
  add(...names) { names.forEach(name => this.set.add(name)); this.owner._class(); }
  remove(...names) { names.forEach(name => this.set.delete(name)); this.owner._class(); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.set.add(name); else this.set.delete(name);
    this.owner._class();
    return on;
  }
  contains(name) { return this.set.has(name); }
}
class MiniElement {
  constructor(document, tag) {
    this.document = document; this.tagName = tag.toUpperCase(); this.id = ''; this.children = [];
    this.parentNode = null; this.style = {}; this.attributes = {}; this.hidden = false; this.disabled = false;
    this.dataset = {}; this.classList = new MiniClassList(this); this._text = ''; this.open = false;
    this.onclick = null; this.oncancel = null;
  }
  _class() { this.attributes.class = [...this.classList.set].join(' '); }
  get className() { return [...this.classList.set].join(' '); }
  set className(value) { this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(value) { this.children = []; this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(c => c !== child); child.parentNode = null; return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  focus() { this.document.activeElement = this; }
  blur() { if (this.document.activeElement === this) this.document.activeElement = this.document.body; }
  click() { if (!this.disabled && this.onclick) this.onclick({target: this}); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  find(id) {
    if (this.id === id) return this;
    for (const child of this.children) { const found = child.find(id); if (found) return found; }
    return null;
  }
}
function createDocument() {
  const listeners = {};
  const document = {
    hidden: false, activeElement: null,
    createElement: tag => new MiniElement(document, tag),
    getElementById: id => document.body.find(id),
    addEventListener(name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); },
    removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter(item => item !== fn); },
    listenerCount: name => (listeners[name] || []).length,
    dispatch(name) { (listeners[name] || []).slice().forEach(fn => fn({type: name})); }
  };
  document.body = new MiniElement(document, 'body');
  document.activeElement = document.body;
  return document;
}
module.exports = {createDocument, MiniElement};

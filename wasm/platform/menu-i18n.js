// Bundled menu localization. Navigation.stop disconnects all localization work.
var MenuI18n = (function() {
  'use strict';
  var key = 'vibelight.language.v1', locale = 'en', running = false, opened = false;
  var observer = null, originals = new WeakMap(), selected = 0;
  var codes = ['en', 'pt-BR', 'es'];
  var names = ['English', 'Português (Brasil)', 'Español'];
  var flags = ['us', 'br', 'es'];
  var entries = MenuTranslations;
  var exact = Object.create(null), reverse = Object.create(null), patterns = [];
  function normalize(value) { return value.replace(/\s+/g, ' ').trim(); }
  entries.forEach(function(row) {
    exact[row[0]] = row;
    row.slice(1).forEach(function(value) { reverse[value] = row[0]; });
    if (row[0].indexOf('{0}') !== -1) {
      var escaped = row[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push({ row: row, re: new RegExp('^' + escaped.replace(/\\\{\d+\\\}/g, '(.+?)') + '$') });
    }
  });
  function supported(value) {
    value = String(value || '').toLowerCase();
    return /^pt(?:-|$)/.test(value) ? 'pt-BR' : /^es(?:-|$)/.test(value) ? 'es' : /^en(?:-|$)/.test(value) ? 'en' : null;
  }
  try { var saved = localStorage.getItem(key); if (codes.indexOf(saved) !== -1) locale = saved; }
  catch (e) { /* Keep the in-session choice if storage is unavailable. */ }
  if (!saved || codes.indexOf(saved) === -1) locale = supported(navigator.language) || 'en';
  function text(value) {
    if (locale === 'en') return value;
    var source = normalize(value), row = exact[source], args = [];
    if (!row) {
      for (var i = 0; i < patterns.length; i++) {
        var match = patterns[i].re.exec(source);
        if (match) { row = patterns[i].row; args = match.slice(1); break; }
      }
    }
    if (!row) return value;
    var translated = row[codes.indexOf(locale)] || row[0];
    translated = translated.replace(/\{(\d+)\}/g, function(_, n) { return args[Number(n)] || ''; });
    return value.replace(/\S[\s\S]*\S|\S/, function() { return translated; });
  }
  function excluded(node) {
    var parent = node.nodeType === 1 ? node : node.parentElement;
    return !parent || !!parent.closest('script,style,.material-icons,[data-i18n-skip="true"],#languageControl,#performance-stats,#connection-warnings,#listener,#libraryHost,.console-card-title,#host-grid .host-container .host-text,#diagnosisReport,#quitAppDialogText b,#pairingDialogText b');
  }
  function canonical(value) {
    var source = reverse[normalize(value)];
    return source ? value.replace(/\S[\s\S]*\S|\S/, function() { return source; }) : value;
  }
  function field(node, attr) {
    if (excluded(node)) return;
    var current = attr ? node.getAttribute(attr) : node.nodeValue;
    if (!current || !normalize(current)) return;
    var fields = originals.get(node);
    if (!fields) { fields = {}; originals.set(node, fields); }
    var k = attr || '#text', previous = fields[k];
    if (!previous || current !== previous.output) previous = { source: canonical(current) };
    var multiline = node.parentElement && node.parentElement.closest('.host-details-text,#systemInfoBtn');
    var output = multiline ? previous.source.split('\n').map(text).join('\n') : text(previous.source);
    previous.output = output; fields[k] = previous;
    if (current !== output) { if (attr) node.setAttribute(attr, output); else node.nodeValue = output; }
  }
  function translate(root) {
    if (!root || excluded(root)) return;
    if (root.nodeType === 3) { field(root); return; }
    if (root.nodeType !== 1) return;
    ['title', 'aria-label', 'placeholder', 'alt'].forEach(function(attr) { field(root, attr); });
    Array.prototype.forEach.call(root.childNodes, translate);
  }
  function refresh() {
    if (!running) return;
    translate(document.body);
    if (observer) observer.takeRecords();
  }
  function updateButton() {
    var index = codes.indexOf(locale), button = document.getElementById('languageBtn');
    document.documentElement.lang = locale;
    document.getElementById('languageFlag').src = 'static/res/flags/' + flags[index] + '.svg';
    document.getElementById('languageName').textContent = ['English', 'Português', 'Español'][index];
    button.setAttribute('aria-label', 'Language / Idioma: ' + names[index]);
    codes.forEach(function(code, i) {
      document.getElementById('language-' + code).setAttribute('aria-checked', String(code === locale));
    });
  }
  function close() {
    if (!opened) return;
    opened = false; isDialogOpen = false;
    document.removeEventListener('click', outside, true);
    document.getElementById('languageMenu').hidden = true;
    document.getElementById('languageBtn').setAttribute('aria-expanded', 'false');
    Navigation.pop();
    focusElement('languageBtn');
  }
  function choose(value) {
    if (!running || codes.indexOf(value) === -1) return;
    locale = value;
    try { localStorage.setItem(key, locale); } catch (e) { /* Session-only fallback. */ }
    updateButton(); refresh(); close();
  }
  function focusChoice(delta) {
    selected = (selected + delta + codes.length) % codes.length;
    codes.forEach(function(code, index) { document.getElementById('language-' + code).classList.toggle('hovered', selected === index); });
    focusElement('language-' + codes[selected]);
  }
  function outside(event) {
    if (!document.getElementById('languageControl').contains(event.target)) close();
  }
  function open() {
    if (!running || isDialogOpen || isInGame) return;
    if (opened) { close(); return; }
    var parent = ConsoleLibrary.visible() ? Views.AppsNav : document.getElementById('settings-list').getClientRects().length ? Views.SettingsNav : Views.HostsNav;
    Navigation.change(parent);
    if (parent === Views.AppsNav) ConsoleLibrary.focusNav(0, 'languageBtn');
    else parent.view.index = Array.prototype.indexOf.call(parent.view.func(), 'languageBtn');
    document.addEventListener('click', outside, true);
    opened = true; isDialogOpen = true; selected = codes.indexOf(locale);
    document.getElementById('languageMenu').hidden = false;
    document.getElementById('languageBtn').setAttribute('aria-expanded', 'true');
    Navigation.push({enter: function() { focusChoice(0); }, leave: function() {},
      up: function() { focusChoice(-1); }, down: function() { focusChoice(1); },
      left: close, right: function() {}, back: close, press: function() {},
      accept: function() { choose(codes[selected]); }, switch: function() { focusChoice(0); }});
  }
  function start() {
    if (running || typeof isInGame !== 'undefined' && isInGame || document.hidden) return;
    running = true;
    refresh();
    if (!observer) observer = new MutationObserver(function(records) {
      // Observe menu text only; no polling, animation frame, or stream hooks.
      records.forEach(function(record) {
        if (record.type === 'attributes') field(record.target, record.attributeName);
        else if (record.type === 'characterData') translate(record.target);
        else Array.prototype.forEach.call(record.addedNodes, translate);
      });
      observer.takeRecords();
    });
    observer.observe(document.body, {subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder', 'alt']});
  }
  function stop() {
    if (observer) { observer.disconnect(); observer.takeRecords(); }
    running = false;
    close();
  }
  document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('languageBtn').onclick = open;
    codes.forEach(function(code) { document.getElementById('language-' + code).onclick = function() { choose(code); }; });
    updateButton(); start();
  });
  return { start: start, stop: stop, choose: choose, locale: function() { return locale; } };
})();

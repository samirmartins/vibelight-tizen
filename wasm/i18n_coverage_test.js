'use strict';
// Every visible text of the page (and every message the app shows) has a translation row, so a word cannot be
// forgotten again in one language only. Texts that must stay as they are are listed here on purpose.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('wasm/platform/menu-translations.js', 'utf8'), ctx);
const rows = JSON.parse(JSON.stringify(ctx.MenuTranslations));
const exact = new Set(rows.map(row => row[0]));
const patterns = rows.filter(row => row[0].includes('{0}')).map(row =>
  new RegExp('^' + row[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\d+\\\}/g, '(.+?)') + '$'));
const normalize = value => value.replace(/\s+/g, ' ').trim();
const covered = text => exact.has(normalize(text)) || patterns.some(re => re.test(normalize(text)));

// Names, key combinations, symbols and bilingual labels that are not translated by design.
const SAME_IN_EVERY_LANGUAGE = new Set(['VibeLight Game Streaming', 'VibeLight Tizen', 'PCs', 'Português (Brasil)', 'English · Português · Español',
  'Language / Idioma', 'Español', '(TV)', '12:34:56:78:9A:BC', 'LB', 'RB', 'LT', 'RT', 'START', 'CTRL + ALT + SHIFT + Q', 'CTRL + ALT + SHIFT + S', '(Xbox)', 'https://samirmartins.github.io/vibelight-tizen/']);
const needsTranslation = text => {
  text = normalize(text);
  return text && /[A-Za-z]{2}/.test(text) && !SAME_IN_EVERY_LANGUAGE.has(text) && !/^[\d\s.x×:%()+\-/]+$/.test(text) && !/^\d+ ?(FPS|Mbps|Kbps|ms|Hz)$/i.test(text) &&
    !/^(VibeLight|Sunshine|VibeShine|H\.264|HEVC|AV1|HDR|Wi-?Fi|OK|FPS|Mbps|PC|Moonlight|English|Esc|Alt|Win|Enter|Tab|Guide)$/i.test(text);
};
const decode = text => text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Static page: text nodes and the attributes the translator also covers.
let html = fs.readFileSync('wasm/index.html', 'utf8');
html = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
html = html.replace(/<(i|span|button)[^>]*class="[^"]*material-icons[^"]*"[^>]*>[\s\S]*?<\/\1>/g, '<x/>');
// The pairing dialog's static text is replaced by the app when it opens (translated rows exist for what it writes).
html = html.replace(/<p id="pairingDialogText">[\s\S]*?<\/p>/, '<p/>');
const missing = new Map();
const check = (text, where) => { text = normalize(decode(text)); if (needsTranslation(text) && !covered(text) && !missing.has(text)) missing.set(text, where); };
for (const m of html.matchAll(/>([^<>]+)</g)) check(m[1], 'texto da página');
for (const m of html.matchAll(/\s(title|aria-label|placeholder|alt)="([^"]*)"/g)) check(m[2], m[1]);

// Messages the app builds in JavaScript.
for (const file of fs.readdirSync('wasm/platform').filter(name => name.endsWith('.js') && !/^menu-(translations|i18n)\.js$/.test(name))) {
  const source = fs.readFileSync('wasm/platform/' + file, 'utf8');
  for (const m of source.matchAll(/(?:snackbarLog(?:Long)?|status|errorDialog|confirmDialog)\(\s*'((?:[^'\\]|\\.)+)'(?!\s*\+)\s*[,)]/g)) check(m[1].replace(/\\'/g, "'"), file);
  for (const m of source.matchAll(/warningDialog\(\s*'((?:[^'\\]|\\.)+)'\s*,\s*'((?:[^'\\]|\\.)+)'(?!\s*\+)/g)) { check(m[1].replace(/\\'/g, "'"), file); check(m[2].replace(/\\'/g, "'"), file); }
}
assert.deepStrictEqual([...missing].map(([text, where]) => where + ': ' + text), [], 'texts without a translation row');
console.log('i18n_coverage_test: every visible text and every app message has a translation row PASS');

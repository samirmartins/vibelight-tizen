'use strict';
// Wording consistency of the user-facing messages: buttons are named as labelled, one word for the wake
// signal and for games, one ellipsis style, and the guide names the Wake PC button as the app does.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('wasm/platform/menu-translations.js', 'utf8') + '\nglobalThis.rows = MenuTranslations;', context);
const rows = Array.from(context.rows).map(r => Array.from(r));
const html = fs.readFileSync('wasm/index.html', 'utf8');
const sources = {html};
for (const dir of ['wasm/platform', 'wasm/static/js']) {
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.js') && file !== 'menu-translations.js' && !/jquery|\.min\./.test(file)) sources[dir + '/' + file] = fs.readFileSync(path.join(dir, file), 'utf8');
  }
}
// Quoted string literals of the code (comments and console logs are not messages).
const literals = [];
for (const [file, text] of Object.entries(sources)) {
  if (file === 'html') continue;
  const code = text.split('\n').filter(line => !/^\s*\/\//.test(line) && !/console\.(log|warn|error)/.test(line)).join('\n');
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) literals.push([file, m[1].replace(/\\'/g, "'")]);
}
const everyEnglish = [...rows.map(r => ['row', r[0]]), ...literals];
const found = needle => everyEnglish.filter(([, text]) => text.includes(needle)).map(([where, text]) => where + ': ' + text.slice(0, 80));

// Buttons are cited by the name they have.
assert.deepStrictEqual(found('Reload VibeLight'), [], 'there is no Reload VibeLight button');
assert.deepStrictEqual(found('reload VibeLight'), []);
assert.deepStrictEqual(found('Refresh the library'), [], 'the button is Refresh PC and library');
assert.deepStrictEqual(found('refresh the library'), []);
assert(found('Refresh PC and library').length >= 3, 'the messages name the button');

// One word for the wake signal, one failure message for sending it.
assert.deepStrictEqual(found('wake packet'), [], 'wake signal, not wake packet');
assert.deepStrictEqual(found('Wake packet'), []);
assert.deepStrictEqual(rows.filter(r => /^Could not send/.test(r[0]) && /wake|Wake-on-LAN|MAC/i.test(r[0])).map(r => r[0]), ['Could not send the wake signal. Check the saved MAC and the local network.']);
assert.deepStrictEqual(rows.filter(r => /^Wake signal sent/.test(r[0])).map(r => r[0]).sort(),
  ['Wake signal sent. Press Play when the PC is ready.', 'Wake signal sent. This does not confirm the PC is awake.']);
for (const r of rows.filter(r => /wake signal/i.test(r[0]) && !/^[✔…]/.test(r[0]))) {
  assert(/sinal/i.test(r[1]) && /señal/i.test(r[2]), 'Portuguese and Spanish say sinal/señal: ' + r[0]);
}

// Games, not applications, in the refresh messages.
assert.deepStrictEqual(found('applications'), []);
assert.deepStrictEqual(found('Refresh apps'), []);
assert(rows.some(r => r[0] === 'Refreshing the list of games from {0}...'), 'the refresh message talks about games');

// One ellipsis style: three dots, as the native stage messages already use. (Restore… is a label that
// opens a dialog, and the … in the steps of the wake wait is a bullet.)
const trailing = text => /…$/.test(text) && text !== 'Restore…';
assert.deepStrictEqual(rows.filter(r => trailing(r[0])).map(r => r[0]), [], 'no single-character ellipsis at the end of a message');
assert.deepStrictEqual(literals.filter(([, text]) => trailing(text)).map(([file, text]) => file + ': ' + text), []);
for (const r of rows.filter(r => /\.\.\.$/.test(r[0]))) {
  assert(/\.\.\.$/.test(r[1]) && /\.\.\.$/.test(r[2]), 'translations keep the three dots: ' + r[0]);
}

// Rows of removed features do not linger (the library search was removed).
for (const gone of ['Search games', 'Type to search games', 'No games found.', 'Reload VibeLight']) {
  assert(!rows.some(r => r[0] === gone), 'no row for the removed text: ' + gone);
}

// The guide names the action like the app does (Ligar PC / Encender PC).
for (const [locale, bad, good] of [['pt-br', 'Acorde o PC', 'Ligue o PC'], ['es', 'Despierta el PC', 'Enciende el PC']]) {
  const guide = fs.readFileSync(`docs/_source/${locale}.json`, 'utf8');
  assert(!guide.includes(`"title": "${bad}"`), locale + ': old title gone');
  assert(guide.includes(`"title": "${good}"`), locale + ': new title');
}
// The guide gives the real path of the setting: the category is PCs and library (not Host Settings).
for (const [locale, good, bad] of [['en', 'Settings → PCs and library → When the PC is off', 'Host Settings'],
  ['pt-br', 'Configurações → PCs e biblioteca → Quando o PC estiver desligado', 'Configurações do PC'],
  ['es', 'Ajustes → PC y biblioteca → Cuando el PC esté apagado', 'Configuración del PC']]) {
  const guide = fs.readFileSync(`docs/_source/${locale}.json`, 'utf8');
  assert(guide.includes(good), locale + ': the guide names the real category');
  assert(!guide.includes(bad + ' → When') && !guide.includes(bad + ' → Quando') && !guide.includes(bad + ' → Cuando'), locale + ': no ' + bad + ' in the path');
}
console.log('message_wording_test: buttons named as labelled, one wake word, games not applications, one ellipsis style PASS');

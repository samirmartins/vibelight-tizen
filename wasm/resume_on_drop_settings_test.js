'use strict';
// The setting "Resume after a connection drop": one switch, on by default, in Advanced → During the game
// right below "Hide connection warnings", reachable with the remote, saved at once, shown on load and
// back on with Restore defaults. Markup, navigation list and index.js wiring.
const assert = require('assert'), fs = require('fs');
const html = fs.readFileSync('wasm/index.html', 'utf8'), nav = fs.readFileSync('wasm/platform/navigation.js', 'utf8'),
  index = fs.readFileSync('wasm/platform/index.js', 'utf8');

const tag = name => `<script type="text/javascript" src="platform/${name}.js"></script>`;
assert.strictEqual(html.split(tag('resume-on-drop')).length - 1, 1, 'index.html loads resume-on-drop once');
assert(html.indexOf(tag('resume-on-drop')) < html.indexOf(tag('console-library')), 'loaded before the library');

assert.strictEqual(html.split('id="resumeOnDropBtn"').length - 1, 1);
assert.strictEqual(html.split('id="resumeOnDropSwitch"').length - 1, 1);
const section = html.slice(html.indexOf('>During the game</h2>'), html.indexOf('>After the game</h2>'));
assert(section.includes('id="resumeOnDropBtn"'), 'in Advanced → During the game');
assert(section.indexOf('id="disableWarningsBtn"') < section.indexOf('id="resumeOnDropBtn"'), 'right below Hide connection warnings');
assert(/<label>Resume after a connection drop<\/label>/.test(section));
assert(/<input type="checkbox" id="resumeOnDropSwitch" class="mdl-switch__input" checked>/.test(section), 'on by default');
assert(/Resume the game automatically when the connection drops/.test(section));

const list = nav.slice(nav.indexOf('AdvancedSettings: {'), nav.indexOf('AboutSettings: {'));
assert(list.indexOf("'disableWarningsBtn'") >= 0 && list.indexOf("'disableWarningsBtn'") < list.indexOf("'resumeOnDropBtn'"), 'right after the warnings option');

assert(/\$\('#resumeOnDropSwitch'\)\.on\('click', saveResumeOnDrop\)/.test(index), 'a click saves the choice');
const save = index.slice(index.indexOf('function saveResumeOnDrop('));
assert(/ResumeOnDrop\.setEnabled\(localStorage/.test(save.slice(0, save.indexOf('\n}\n'))), 'saved with the module');
assert(/ResumeOnDrop\.enabled\(localStorage\)/.test(index), 'the stored choice is shown at start-up');
const reset = index.slice(index.indexOf('function restoreDefaultsSettingsValues('));
const resetBody = reset.slice(0, reset.indexOf('\n}\n'));
assert(/#resumeOnDropBtn'\)\.MaterialSwitch\.on\(\)/.test(resetBody) && /ResumeOnDrop\.setEnabled\(localStorage, true\)/.test(resetBody), 'restore defaults turns it on');
assert(/typeof ResumeOnDrop !== 'undefined'/.test(index), 'a missing module cannot stop the settings');
console.log('resume_on_drop_settings_test: switch on by default below Hide connection warnings, saved, shown, reset PASS');

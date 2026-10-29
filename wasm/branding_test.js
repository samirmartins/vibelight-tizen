'use strict';
const fs = require('fs'), cp = require('child_process'), assert = require('assert');
const normalize = require('./branding-scope.cjs').normalize;
const files = ['wasm/platform/index.js', 'wasm/platform/console-library.js', 'wasm/platform/messages.js',
  'wasm/main.cpp', 'wasm/index.html', 'CMakeLists.txt', 'res/config.xml'];
for (const file of files) {
  const current = fs.readFileSync(file, 'utf8');
  const stable = cp.execFileSync('git', ['show', 'v3.4.10:' + file], {encoding: 'utf8'});
  assert.strictEqual(normalize(file, current), stable, file + ': display-only changes');
  const mutation = current + '\nthrow new Error("unexpected behavior");\n';
  assert.notStrictEqual(normalize(file, mutation), stable, 'neighboring changes are not hidden');
}
// No native, protocol, input, audio, clock, diagnostic or session logic changes.
const frozen = ['moonlight-common-c', 'libgamestream', 'h264bitstream',
  'wasm/*.cpp', 'wasm/*.hpp', 'wasm/platform', 'wasm/static/js',
  'wasm/static/css/style.css', 'wasm/static/css/menu-tools.css',
  'wasm/static/css/console-library.css', 'wasm/static/css/controller-mapping.css'];
const changed = cp.execFileSync('git', ['diff', '--name-only', 'v3.4.10', '--', ...frozen], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
const pacing = require('./frame-pacing-scope.cjs');
const remaining = changed.filter(file => {
  const current=fs.readFileSync(file,'utf8');
  if (file === 'wasm/platform/messages.js') return false; // Exact normalized handler verified above.
  if (['wasm/platform/menu-i18n.js','wasm/platform/menu-translations.js'].includes(file)) return false;
  if (file === 'wasm/platform/release-update.js') {
    assert.strictEqual(require('crypto').createHash('sha256').update(current).digest('hex'),
      '9d814d3a7cc57dc1783d8d434b2287c34a941f7e79647a421db79d7c240621af', 'exact release notice module');
    return false;
  }
  const access=require('./controller-access-scope.cjs');
  if(access.files.includes(file)) {
    assert.strictEqual(access.normalize(file,current),cp.execFileSync('git',['show','v3.4.13:'+file],{encoding:'utf8'}));
    return false;
  }
  const identity=require('./controller-identity-scope.cjs');
  if(identity.files.includes(file)) {
    assert.strictEqual(identity.normalize(file,current),cp.execFileSync('git',['show','v3.4.10:'+file],{encoding:'utf8'}),
      'exact independently tested controller identity integration: '+file);return false;
  }
  const beforeReturn=require('./stream-return-scope.cjs').normalize(file,current);
  if(beforeReturn!==current&&!files.includes(file)&&!pacing.files.includes(file)) {
    assert.strictEqual(beforeReturn,cp.execFileSync('git',['show','v3.4.10:'+file],{encoding:'utf8'}),
      'exact independently tested stop-to-menu integration: '+file);return false;
  }
  if (pacing.files.includes(file) && !files.includes(file)) {
    const normalized = pacing.normalize(file, fs.readFileSync(file, 'utf8'));
    const old = pacing.added.includes(file) ? '' : cp.execFileSync('git', ['show', 'v3.4.10:' + file], {encoding:'utf8'});
    assert.strictEqual(normalized, old, 'exact optional pacing change: ' + file); return false;
  }
  if (['wasm/frame_pacing_fixture.c', 'wasm/frame_pacing_test.cpp'].includes(file)) {
    assert(!fs.readFileSync('CMakeLists.txt','utf8').includes(file)); return false;
  }
  return true;
});
assert.deepStrictEqual(remaining.sort(), files.filter(f => (f.startsWith('wasm/platform/') && !f.endsWith('/messages.js')) || f === 'wasm/main.cpp').sort());
const html = fs.readFileSync('wasm/index.html', 'utf8');
for (const file of ['docs/images/vibelight-code-mark.svg', 'docs/images/vibelight-code-logo.svg']) {
  const svg = fs.readFileSync(file, 'utf8');
  assert(!/<mask\b|\bmask=|<rect\b/.test(svg), 'approved logo has no cutout or badge background');
  assert(svg.includes('&lt;/&gt;'), 'Code label is retained');
}
assert(html.indexOf('static/css/vibelight.css') > html.indexOf('static/css/controller-mapping.css'));
assert(!html.includes('>Moonlight') && !html.includes('Reload Moonlight'));
assert(html.includes('data-name="moonlight-tizen"'), 'internal identity is unchanged');
const css = fs.readFileSync('wasm/static/css/vibelight.css', 'utf8');
assert(!/[{;]\s*(?:filter|backdrop-filter|transition|animation|transform)\s*:/.test(css), 'no runtime effects added');
for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  assert(rule[1].split(',').every(s => s.trim() === '#header-logo' || s.trim().startsWith('#controllerMappingDialog')), 'only the approved mark and editor may be styled');
}
assert(!/#(?:performance-stats|connection-warnings)\b|\.fullscreen\b|\bcanvas\b|\bvideo\b/.test(css), 'stream surfaces and overlay are untouched');
assert(css.includes('background: #333846') && css.includes('background: #282c38'));
console.log('branding_test: stable runtime/IDs/defaults retained; original global colors and scoped block editor/Code identity only PASS');

assert(fs.readFileSync('wasm/static/res/vibelight-splash.png').equals(fs.readFileSync('docs/images/vibelight-readme-logo.png')), 'startup artwork matches README');

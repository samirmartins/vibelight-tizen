'use strict';
const fs = require('fs'), assert = require('assert');
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
assert(fs.readFileSync('wasm/static/res/vibelight-splash.png').equals(fs.readFileSync('docs/images/vibelight-readme-logo.png')), 'startup artwork matches README');
console.log('branding_test: logo without cutout, internal identity, scoped CSS without runtime effects and matching splash PASS');

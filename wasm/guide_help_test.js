'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const url='https://samirmartins.github.io/vibelight-tizen/';
const html=fs.readFileSync('wasm/index.html','utf8');
assert(html.includes('id="guideHelpDialog"'),'dedicated guide dialog is bundled');
assert(html.includes(url),'a readable destination accompanies the QR');
const svg=fs.readFileSync('wasm/static/res/guide-qr.svg','utf8');
assert(svg.includes('<title>'+url+'</title>'));
assert(!/<script|<image|href=|onload=|https?:/i.test(svg.replace(url,'').replace('http://www.w3.org/2000/svg','')),'QR is self-contained geometry');
const source=fs.readFileSync('wasm/platform/guide-help.js','utf8');
assert(!/fetch\(|XMLHttpRequest|setTimeout|setInterval|localStorage|navigator\./.test(source),'guide has no network, storage or polling');
const calls=[],nodes={guideHelpControls:{},guideHelpClose:{}};
const c={isInGame:false,isDialogOpen:false,document:{hidden:false,getElementById:id=>nodes[id]},
 openUtilityDialog(...args){calls.push(['open',...args]);c.isDialogOpen=true;},
 closeUtilityDialog(id){calls.push(['close',id]);c.isDialogOpen=false;},
 navigationGuideDialog(back){calls.push(['controls']);c.returnFromControls=back;}};
vm.runInNewContext(source,c);
c.GuideHelp.open();assert.equal(calls[0][1],'guideHelpDialog');
assert.deepStrictEqual(Array.from(calls[0][2]),['guideHelpClose','guideHelpControls'],'Back receives initial focus');
assert.equal(calls[0][4],'navigationGuideBtn');
c.GuideHelp.open();assert.equal(calls.length,1,'repeated activation does not stack dialogs');
nodes.guideHelpControls.onclick();assert.deepStrictEqual(calls.slice(1),[['close','guideHelpDialog'],['controls']]);
c.returnFromControls();assert.equal(calls.at(-1)[0],'open','controls return to the guide');
nodes.guideHelpClose.onclick();assert.equal(c.isDialogOpen,false);
for(const blocked of ['isInGame','isDialogOpen','hidden']){
 const count=calls.length;if(blocked==='hidden')c.document.hidden=true;else c[blocked]=true;
 c.GuideHelp.open();assert.equal(calls.length,count,blocked+' blocks an unrelated dialog');
 if(blocked==='hidden')c.document.hidden=false;else c[blocked]=false;
}
const index=fs.readFileSync('wasm/platform/index.js','utf8');
assert(index.includes("$('#navigationGuideBtn').on('click', GuideHelp.open);"));
assert(index.includes("if (typeof onClose === 'function') onClose();"),'legacy controls preserve their close owner and optional guide return');
console.log('guide_help_test: bundled destination, no network/polling, one dialog, safe controls handoff and lifecycle guards PASS');

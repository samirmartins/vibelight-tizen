'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const menu=fs.readFileSync('wasm/platform/controller-mapping-menu.js','utf8');
function fixture() {
  const nodes=new Map(),listeners=new Map();
  function classes(node) {
    return {contains:c=>node.className.split(' ').includes(c),
      toggle(c,on){const all=new Set(node.className.split(' ').filter(Boolean));on?all.add(c):all.delete(c);node.className=[...all].join(' ');},
      remove(...values){values.forEach(c=>this.toggle(c,false));}};
  }
  function element(tag='div') {
    const node={tagName:tag.toUpperCase(),children:[],className:'',style:{},disabled:false,hidden:false,
      setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},getClientRects:()=>[{}],scrollIntoView(){},
      focus(){document.activeElement=this;},click(){if(this.onclick)this.onclick();},getBoundingClientRect:()=>({left:0,right:10,top:0,bottom:10}),
      addEventListener(){},appendChild(child){this.children.push(child);if(child.id)nodes.set(child.id,child);},
      querySelectorAll(selector){return [...nodes.values()].filter(n=>selector==='button'?n.tagName==='BUTTON':selector[0]==='.'?n.classList.contains(selector.slice(1)):n.classList.contains('cm-active')||n.classList.contains('cm-pressed'));}};
    node.classList=classes(node);
    Object.defineProperty(node,'textContent',{get(){return this.text||'';},set(value){this.text=value;this.children=[];}});
    Object.defineProperty(node,'innerHTML',{set(html){
      for(const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const child=element(match[1]);child.id=match[3];
        child.className=(match[2].match(/class="([^"]+)"/)||[])[1]||'';
        child.hidden=/\bhidden\b/.test(match[2]);nodes.set(child.id,child);
      }
    }});
    return node;
  }
  const document={hidden:false,activeElement:null,body:element(),createElement:element,getElementById:id=>nodes.get(id),addEventListener(){},removeEventListener(){}};
  function addEventListener(name,fn,capture){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push({fn,capture:!!capture});}
  function removeEventListener(name,fn){listeners.set(name,(listeners.get(name)||[]).filter(item=>item.fn!==fn));}
  function dispatch(name,properties={}) {
    const event={...properties,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
    const items=(listeners.get(name)||[]).slice().sort((a,b)=>Number(b.capture)-Number(a.capture));
    for(const item of items){item.fn(event);if(event.stopped)break;}
    return event;
  }
  const context={console,document,navigator:{getGamepads:()=>[]},isInGame:false,isDialogOpen:false,
    repeatTimeout:1,navigationTimeout:2,repeatAction:()=>{},clearTimeout(){},Date:{now:()=>1000},
    requestAnimationFrame(){throw Error('no animation frames in the editor');},cancelAnimationFrame(){},
    addEventListener,removeEventListener,localStorage:{getItem:()=>null,setItem(){}},
    openUtilityDialog(){nodes.get('controllerMappingDialog').open=true;context.isDialogOpen=true;},
    closeUtilityDialog(){nodes.get('controllerMappingDialog').open=false;context.isDialogOpen=false;},
    focusElement(){},Navigation:{change(v){context.view=v;}}};
  context.window=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync('wasm/platform/controller-mapping.js','utf8'),context);
  vm.runInContext(fs.readFileSync('wasm/platform/controller-tuning.js','utf8'),context);
  vm.runInContext(menu,context);
  return {c:context,node:id=>nodes.get(id),open(){context.ControllerMappingMenu.open();},
    dispatch,listeners:name=>(listeners.get(name)||[]).length};
}
const f=fixture();f.open();
const dialog=f.node('controllerMappingDialog');
assert(dialog.open);
// Escape/Back closes the analog panel before leaving the editor.
f.node('cm-analog-row').onclick();
let cancel={preventDefault(){this.prevented=true;}};
dialog.oncancel(cancel);
assert.strictEqual(cancel.prevented,true);
assert.strictEqual(f.node('cm-analog-panel').hidden,true,'Back closes the analog panel first');
assert.strictEqual(dialog.open,true,'Back keeps the editor open after closing the panel');
dialog.oncancel(cancel);
assert.strictEqual(dialog.open,false,'Back then leaves the editor');
f.open();
f.node('cm-analog-row').onclick();
assert.strictEqual(f.node('cm-analog-panel').hidden,false);
f.node('cm-cancel').onclick();
f.open();
assert.strictEqual(f.node('cm-analog-panel').hidden,true,'reopening starts with the analog panel closed');
assert.strictEqual(f.node('cm-family-xbox').className.includes('cm-active'),true);
assert.strictEqual(f.node('cm-art').src,'static/res/controller-xbox.png');
assert.strictEqual(f.node('cm-key-grid').children.length,16,'all editable physical buttons have a key');
assert.strictEqual(f.node('cm-selected').textContent,'B','Xbox opens on the right face button');
assert.strictEqual(f.node('cm-target-value').textContent,'B');
assert(f.node('cm-family-hint').textContent.includes('switch family'),'footer shows the family shortcut');
// Deterministic grid navigation, focus-follows-selection and A-to-change.
f.c.view.right();
assert.strictEqual(f.node('cm-selected').textContent,'X','right moves to X');
f.c.view.left();
assert.strictEqual(f.node('cm-selected').textContent,'B','left returns to B');
f.node('cm-key-3').onclick();
assert.strictEqual(f.node('cm-selected').textContent,'Y','8-column grid selects Y');
f.c.view.down();
assert.strictEqual(f.node('cm-selected').textContent,'RS','Down moves to the next grid row');
f.c.view.up();
assert.strictEqual(f.node('cm-selected').textContent,'Y','Up returns to the previous grid row');
f.node('cm-key-1').onclick();
assert.strictEqual(f.node('cm-selected').textContent,'B','restore B for the remaining flow');
f.c.view.accept();
assert.strictEqual(f.node('cm-choice').hidden,false,'A opens Change for the focused key');
assert.strictEqual(f.c.document.activeElement.id,'cm-target-1','target chooser starts on the current target');
f.c.view.right();
assert.strictEqual(f.c.document.activeElement.id,'cm-target-0','Right wraps inside the two-column target row');
f.c.view.left();
assert.strictEqual(f.c.document.activeElement.id,'cm-target-1');
f.c.view.down();
assert.strictEqual(f.c.document.activeElement.id,'cm-target-3','Down moves to the next target row');
f.c.view.up();
assert.strictEqual(f.c.document.activeElement.id,'cm-target-1');
for(let i=0;i<7;i++)f.c.view.down();
assert.strictEqual(f.c.document.activeElement.id,'cm-choice-cancel','Down from the last target reaches Back');
f.c.view.up();
assert.strictEqual(f.c.document.activeElement.id,'cm-target-15','Up from Back returns to the last target');
f.c.view.back();
assert.strictEqual(f.node('cm-choice').hidden,true,'Back closes the target chooser');
assert.strictEqual(f.c.document.activeElement.id,'cm-change','Back returns to Change');
// L1/R1 switch family with wrap, keeping the selected key.
f.dispatch('gamepadinputchanged',{detail:{changes:[{type:'button',index:4,pressed:true}]}});
assert(f.node('cm-family-nintendo').classList.contains('cm-active'),'L1 wraps to Switch');
assert(f.node('cm-family-hint').textContent.includes('switch family'),'footer remains visible after the Switch switch');
f.dispatch('gamepadinputchanged',{detail:{changes:[{type:'button',index:5,pressed:true}]}});
assert(f.node('cm-family-xbox').classList.contains('cm-active'),'R1 returns to Xbox');
assert.strictEqual(f.node('cm-selected').textContent,'B','family switch keeps the selected key');
f.node('cm-family-nintendo').onclick();
assert.strictEqual(f.node('cm-art').src,'static/res/controller-switch.png');
assert.strictEqual(f.node('cm-selected').textContent,'B');
assert.strictEqual(f.node('cm-target-value').textContent,'B');
const changes=f.node('cm-changes').children.map(c=>c.textContent).join(' ');
assert.strictEqual(changes,'No swaps','Switch defaults to the reported layout without swaps');
f.node('cm-change').onclick();
assert.strictEqual(f.node('cm-inspector-main').hidden,true);
assert.strictEqual(f.node('cm-choice').hidden,false);
assert(f.node('cm-targets').children.length>=1);
f.node('cm-target-2').onclick();
assert.strictEqual(f.node('cm-selected').textContent,'B');
assert(f.node('cm-target-value').textContent.includes('X'),'target selection updates the draft');
f.node('cm-analog-row').onclick();
assert.strictEqual(f.node('cm-analog-panel').hidden,false);
assert.strictEqual(f.node('cm-deadzone').disabled,true);
f.node('cm-tuning-enabled').onclick();
assert.strictEqual(f.node('cm-deadzone').disabled,false);
for(let i=0;i<5;i++)f.node('cm-deadzone').onclick();
assert.strictEqual(f.node('cm-deadzone').textContent,'Deadzone: 25%');
for(let i=0;i<5;i++)f.node('cm-trigger-threshold').onclick();
assert.strictEqual(f.node('cm-trigger-threshold').textContent,'Trigger threshold: 25%');
assert(f.node('cm-analog-title').textContent.includes('Switch'),'analog panel names the family');
f.node('cm-family-xbox').onclick();
assert.strictEqual(f.node('cm-deadzone').textContent,'Deadzone: none','Xbox analog stays neutral');
assert.strictEqual(f.node('cm-analog-panel').hidden,false,'family switch keeps the panel open');
f.node('cm-family-nintendo').onclick();
assert.strictEqual(f.node('cm-deadzone').textContent,'Deadzone: 25%','Switch analog remains independent');
f.c.view.back();
assert.strictEqual(f.node('cm-analog-panel').hidden,true,'B closes the analog panel');
assert.strictEqual(f.node('cm-analog-row').classList.contains('cm-selected'),false);
f.c.view.down();
assert.strictEqual(f.node('cm-analog-panel').hidden,true,'Down moves to the footer, not the panel');
assert.strictEqual(f.c.document.activeElement.id,'cm-cancel','Down lands on Cancel');
f.c.view.left();
assert.strictEqual(f.c.document.activeElement.id,'cm-reset','Left from Cancel reaches Restore');
f.c.view.right();
assert.strictEqual(f.c.document.activeElement.id,'cm-cancel','Right from Restore returns to Cancel');
f.c.view.right();
assert.strictEqual(f.c.document.activeElement.id,'cm-save','Right from Cancel reaches Save');
f.c.view.right();
assert.strictEqual(f.c.document.activeElement.id,'cm-reset','Footer cycles with wrap');
f.c.view.up();
assert.strictEqual(f.c.document.activeElement.id,'cm-analog-row','Up returns to Analog row');
f.c.view.accept();
assert.strictEqual(f.node('cm-analog-panel').hidden,false,'A opens the analog panel');
assert(f.node('cm-analog-help').textContent.includes('B'),'analog panel shows the exit hint');
f.c.view.back();
f.node('cm-test').onclick();
assert.strictEqual(f.listeners('gamepadinputchanged'),2,'test listener only while testing');
assert.strictEqual(f.node('cm-test-hint').hidden,false,'test exit hint is visible');
assert(f.node('cm-test-hint-text').textContent.includes('Guide'),'test exit hint names the Guide button');
assert.strictEqual(f.node('cm-key-0').textContent,'A');
assert.strictEqual(f.node('cm-key-1').textContent,'B');
assert.strictEqual(f.node('cm-key-2').textContent,'X');
assert.strictEqual(f.node('cm-key-3').textContent,'Y');
assert.strictEqual(f.node('cm-key-8').textContent,'-','Minus is shown as a sign');
assert.strictEqual(f.node('cm-key-9').textContent,'+','Plus is shown as a sign');
f.dispatch('gamepadinputchanged',{detail:{changes:[{type:'button',index:1,pressed:true}]}});
assert(f.node('cm-key-1').classList.contains('cm-pressed'));
f.dispatch('gamepadinputchanged',{detail:{changes:[{type:'button',index:1,pressed:false}]}});
assert(!f.node('cm-key-1').classList.contains('cm-pressed'));
f.node('cm-test').onclick();
assert.strictEqual(f.listeners('gamepadinputchanged'),1,'test listener removed while family shortcut remains');
assert.strictEqual(f.node('cm-test-hint').hidden,true,'test exit hint hides after test');
f.node('cm-save').onclick();
assert.strictEqual(f.node('controllerMappingDialog').open,false);
assert.strictEqual(f.c.ControllerMapping.get().profiles.nintendo.map[1],2,'saved the Nintendo profile independently');
assert.strictEqual(f.c.ControllerMapping.get().profiles.playstation.map[1],1,'PlayStation profile untouched');
assert.strictEqual(f.c.ControllerTuning.get().profiles.nintendo.enabled,true);
assert.strictEqual(f.c.ControllerTuning.get().profiles.xbox.enabled,false,'Xbox analog remains neutral');
f.open();
assert(f.node('cm-family-nintendo').classList.contains('cm-active'),'reopen remembers the last family');
assert.strictEqual(f.node('cm-selected').textContent,'B','reopen remembers the last key');
const art=['controller-ps5.png','controller-switch.png','controller-xbox.png'];
for(const name of art){const path='wasm/static/res/'+name;assert(fs.statSync(path).size>100000,name+' present');}
const css=fs.readFileSync('wasm/static/css/controller-mapping.css','utf8');
for(const selector of ['.cm-key-grid','.cm-key','.cm-tabs','.cm-targets','.cm-analog-row'])assert(css.includes(selector),selector);
assert(!css.includes('.cm-sprite'),'old atlas test styles removed');
console.log('controller_test_mode_test: per-family tabs/art, L1/R1 and grid navigation, A-to-change, per-family analog panel entry/exit, footer focus group and wrap, physical key grid, Switch A/B/X/Y and -/+ labels, Guide exit hint, reported layout, target choice, analog 25% limits, test highlights, independent saves and new styles PASS');

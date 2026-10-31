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
      focus(){document.activeElement=this;},getBoundingClientRect:()=>({left:0,right:10,top:0,bottom:10}),
      addEventListener(){},appendChild(child){this.children.push(child);if(child.id)nodes.set(child.id,child);},
      querySelectorAll(selector){return [...nodes.values()].filter(n=>selector==='button'?n.tagName==='BUTTON':n.classList.contains('cm-active')||n.classList.contains('cm-pressed'));}};
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
assert(f.node('controllerMappingDialog').open);
assert.strictEqual(f.node('cm-family-xbox').className.includes('cm-active'),true);
assert.strictEqual(f.node('cm-art').src,'static/res/controller-xbox.png');
assert.strictEqual(f.node('cm-hotspots').children.length,16,'all editable physical buttons have hotspots');
assert.strictEqual(f.node('cm-selected').textContent,'B','Xbox opens on the right face button');
assert.strictEqual(f.node('cm-target-value').textContent,'B');
f.node('cm-family-nintendo').onclick();
assert.strictEqual(f.node('cm-art').src,'static/res/controller-switch.png');
assert.strictEqual(f.node('cm-selected').textContent,'A');
assert.strictEqual(f.node('cm-target-value').textContent,'A ↔ B');
const changes=f.node('cm-changes').children.map(c=>c.textContent).join(' ');
assert(changes.includes('A ↔ B')&&changes.includes('X ↔ Y'),'default Switch labels show both face swaps');
f.node('cm-change').onclick();
assert.strictEqual(f.node('cm-inspector-main').hidden,true);
assert.strictEqual(f.node('cm-choice').hidden,false);
assert(f.node('cm-targets').children.length>=1);
f.node('cm-target-2').onclick();
assert.strictEqual(f.node('cm-selected').textContent,'A');
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
f.node('cm-test').onclick();
assert.strictEqual(f.listeners('gamepadinputchanged'),1,'test listener only while testing');
f.dispatch('gamepadinputchanged',{detail:{changes:[{type:'button',index:1,pressed:true}]}});
assert(f.node('cm-hs-1').classList.contains('cm-pressed'));
f.dispatch('gamepadinputchanged',{detail:{changes:[{type:'button',index:1,pressed:false}]}});
assert(!f.node('cm-hs-1').classList.contains('cm-pressed'));
f.node('cm-test').onclick();
assert.strictEqual(f.listeners('gamepadinputchanged'),0,'test listener removed');
f.node('cm-save').onclick();
assert.strictEqual(f.node('controllerMappingDialog').open,false);
assert.strictEqual(f.c.ControllerMapping.get().profiles.nintendo.map[1],2,'saved the Nintendo profile independently');
assert.strictEqual(f.c.ControllerMapping.get().profiles.playstation.map[1],1,'PlayStation profile untouched');
assert.strictEqual(f.c.ControllerTuning.get().enabled,true);
const art=['controller-ps5.png','controller-switch.png','controller-xbox.png'];
for(const name of art){const path='wasm/static/res/'+name;assert(fs.statSync(path).size>100000,name+' present');}
const css=fs.readFileSync('wasm/static/css/controller-mapping.css','utf8');
for(const selector of ['.cm-hotspot','.cm-tabs','.cm-targets','.cm-analog-row'])assert(css.includes(selector),selector);
assert(!css.includes('.cm-sprite'),'old atlas test styles removed');
console.log('controller_test_mode_test: per-family tabs/art, hotpots, swaps, target choice, analog 25% limits, test highlights, independent saves and new styles PASS');

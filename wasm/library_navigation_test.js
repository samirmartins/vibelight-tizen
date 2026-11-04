'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),cp=require('child_process');
const read=file=>fs.readFileSync(file,'utf8');
const old=file=>cp.execFileSync('git',['show','v3.4.8:'+file],{encoding:'utf8'});
const index=read('wasm/platform/index.js'),gamepad=read('wasm/platform/gamepad.js');
const controller=read('wasm/platform/library-navigation.js');
function fixture(legacy=false) {
 let now=0,serial=0,peak=0,raf=0,visible=true,running=true;
 const timers=new Map(),listeners=new Map(),moves=[],events=[];
 const pads=Array.from({length:2},(_,index)=>({index,connected:true,
  buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0,0,0]}));
 const add=(fn,delay,interval)=>{const id=++serial;timers.set(id,{fn,at:now+delay,interval});peak=Math.max(peak,timers.size);return id;};
 const c={console,isInGame:false,isDialogOpen:false,isGamepadActive:false,
  repeatAction:null,lastInvokeTime:0,repeatTimeout:null,navigationTimeout:null,
  REPEAT_DELAY:350,REPEAT_INTERVAL:100,ACTION_THRESHOLD:0.5,NAVIGATION_DELAY:150,
  document:{hidden:false},navigator:{getGamepads:()=>pads},
  setTimeout:(fn,delay)=>add(fn,delay,0),clearTimeout:id=>timers.delete(id),
  setInterval:(fn,delay)=>add(fn,delay,delay),clearInterval:id=>timers.delete(id),
  requestAnimationFrame:fn=>{raf++;return add(()=>fn(now),16,0);},
  Date:{now:()=>now},ConsoleLibrary:{visible:()=>visible},Navigation:{isRunning:()=>running},
  CustomEvent:function(type,init){this.type=type;this.detail=init.detail;},
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
  removeEventListener(type,fn){if(listeners.has(type))listeners.get(type).delete(fn);},
  dispatchEvent(event){events.push(event);for(const fn of listeners.get(event.type)||[])fn(event);}};
 c.window=c;
 for(const name of ['left','right','up','down','accept','back','press'])c.Navigation[name]=()=>moves.push([name,now]);
 vm.createContext(c);
 const ui=legacy?old('wasm/platform/index.js'):index;
 const padSource=legacy?old('wasm/platform/gamepad.js'):gamepad;
 vm.runInContext(padSource.slice(0,padSource.indexOf('// Streaming gamepad publisher'))+'\nwindow.menuController=Controller;',c);
 if(!legacy)vm.runInContext(controller,c);
 const first=ui.indexOf("  window.addEventListener('gamepadinputchanged', (e) => {");
 const last=ui.indexOf('\n}\n\nfunction changeUiModeForWasmLoad',first);
 assert(first>0&&last>first);
 vm.runInContext(ui.slice(first,last),c);
 if(legacy)vm.runInContext(ui.slice(ui.indexOf('function repeatActionHandler()'),ui.indexOf('// Updates the host status indicator')),c);
 c.menuController.startWatching();
 function advance(to) {
  let steps=0;
  while(true){let chosen=null;for(const [id,t]of timers)if(t.at<=to&&(!chosen||t.at<chosen[1].at))chosen=[id,t];
   if(!chosen)break;assert(++steps<100000,'bounded scheduler');const[id,t]=chosen;now=t.at;
   if(t.interval)t.at+=t.interval;else timers.delete(id);t.fn();
  }now=to;
 }
 return {c,pads,moves,events,advance,timers,stats:()=>({peak,raf}),
  axis(x,y=0,slot=0){pads[slot].axes[0]=x;pads[slot].axes[1]=y;},
  button(index,pressed,slot=0){pads[slot].buttons[index]={pressed,value:Number(pressed)};},
  hide(){visible=false;running=false;if(!legacy)c.LibraryNavigation.reset();},
  show(){visible=true;running=true;},stop(){c.menuController.stopWatching();},
  unplug(slot){pads[slot]=null;c.dispatchEvent({type:'gamepaddisconnected',gamepad:{index:slot}});}};
}
// Real 16 ms polling and the real index.js listener, not a rewritten algorithm.
const baseline=fixture(true),current=fixture();
for(const f of [baseline,current]){f.axis(.8);f.advance(200);}
assert.deepStrictEqual(baseline.moves[0],['right',166]);
assert.deepStrictEqual(current.moves[0],['right',16]);
const noiseOld=fixture(true),noise=fixture();
for(let t=0;t<800;t+=16){for(const f of [noiseOld,noise]){f.axis(t%32?.79:.81);f.advance(t+16);}}
assert.strictEqual(noiseOld.moves.length,0,'reproduce analog debounce starvation in stable');
assert.deepStrictEqual(noise.moves.map(m=>m[1]),[16,366,466,566,666,766]);
assert.strictEqual(noise.stats().peak,2,'one poll plus one repeat, despite analog noise');
assert.strictEqual(noise.stats().raf,0,'no animation-frame repeat chains');
for(const legacy of [true,false]) {
 const f=fixture(legacy);f.axis(.8);f.advance(80);f.axis(0);f.advance(300);
 assert.strictEqual(f.moves.length,1);
 assert.strictEqual(f.moves[0][1],legacy?166:16,'new short tap is not delivered after release');
 if(!legacy)assert.strictEqual(f.timers.size,1,'no repeat after neutral');
}
for(const kind of ['neutral-axis','unrelated-release']) {
 const a=fixture(true),b=fixture();
 for(const f of [a,b]){if(kind==='unrelated-release')f.button(5,true);f.button(15,true);}
 for(let t=0;t<1000;t+=16)for(const f of [a,b]){
  if(kind==='neutral-axis')f.axis(t%32?.01:.02);
  else if(t>=200)f.button(5,false);
  f.advance(t+16);
 }
 assert.strictEqual(a.moves.length,1,'reproduce interrupted D-pad repeat: '+kind);
 assert.deepStrictEqual(b.moves.map(m=>m[1]),[16,366,466,566,666,766,866,966]);
}
for(const [first,second]of [[14,15],[15,14],[12,13],[13,12]]) {
 const f=fixture();f.button(first,true);f.advance(200);f.button(first,false);f.button(second,true);f.advance(800);
 assert.deepStrictEqual(f.moves.map(m=>m[1]),[16,208,558,658,758],'symmetric direction reversal');
}
const hysteresis=fixture();hysteresis.axis(.51);hysteresis.advance(16);
for(let t=16;t<500;t+=16){hysteresis.axis(t%32?.49:.52,.02);hysteresis.advance(t+16);}
assert.deepStrictEqual(hysteresis.moves.map(m=>m[1]),[16,366,466]);
hysteresis.axis(.34);hysteresis.advance(800);assert.strictEqual(hysteresis.moves.length,3);
const diagonal=fixture();
for(let t=0;t<800;t+=16){diagonal.axis(t%32?.79:.81,t%32?.81:.79);diagonal.advance(t+16);}
assert(diagonal.moves.every(m=>m[0]==='right'),'diagonal noise keeps a stable axis');
diagonal.axis(.4,.95);diagonal.advance(816);assert.strictEqual(diagonal.moves.at(-1)[0],'down');
const digital=fixture();digital.button(15,true);digital.button(12,true);digital.advance(500);
assert(digital.moves.every(m=>m[0]==='right'),'one stable direction for a digital diagonal');
digital.button(14,true);digital.button(12,false);digital.advance(800);
assert.strictEqual(digital.moves.length,3,'opposite directions cancel, never fall through to analog');
const priority=fixture();priority.button(15,true);priority.axis(-.9);priority.advance(500);
assert(priority.moves.every(m=>m[0]==='right'),'digital direction takes priority over analog');
const multiple=fixture();multiple.button(15,true);multiple.advance(100);
multiple.axis(.02,0,1);multiple.advance(500);assert.strictEqual(multiple.moves.length,3);
multiple.button(14,true,1);multiple.advance(520);assert.strictEqual(multiple.moves.at(-1)[0],'left');
multiple.axis(.01);multiple.advance(540);assert.strictEqual(multiple.moves.at(-1)[0],'left','old controller noise cannot steal focus back');
multiple.button(15,false);multiple.advance(1000);assert.strictEqual(multiple.moves.at(-1)[0],'left');
multiple.unplug(1);const before=multiple.moves.length;multiple.advance(1500);assert.strictEqual(multiple.moves.length,before);
assert(multiple.events.filter(e=>e.type==='gamepadinputchanged').some(e=>e.detail.padIndex===1));
for(const transition of ['dialog','hidden','game','stop','library']) {
 const f=fixture();f.axis(.8);f.advance(20);
 if(transition==='dialog'){f.c.isDialogOpen=true;f.c.LibraryNavigation.viewChanged();}
 if(transition==='hidden')f.c.document.hidden=true;
 if(transition==='game')f.c.isInGame=true;
 if(transition==='stop')f.stop();
 if(transition==='library')f.hide();
 f.advance(1000);assert.strictEqual(f.moves.length,1,'repeat cancelled at '+transition);
 assert.strictEqual(f.timers.size,transition==='stop'?0:1,'no stale repeat work at '+transition);
}
const reset=fixture();reset.axis(.8);reset.advance(20);
const stale=Array.from(reset.timers.values()).find(t=>!t.interval).fn;
reset.hide();reset.show();reset.button(13,true);reset.advance(32);stale();reset.advance(500);
assert.deepStrictEqual(reset.moves.map(m=>m[0]),['right','down','down','down'],'old queued callback is inert');
for(const legacy of [true,false]){
 const f=fixture(legacy);f.c.ConsoleLibrary.visible=()=>false;f.axis(.8);f.advance(200);
 assert.deepStrictEqual(f.moves,[['right',legacy?166:16]],'Settings and PC menus use corrected directional behavior');
 const game=fixture(legacy);game.c.isInGame=true;game.axis(.8);game.button(15,true);game.advance(1000);
 assert.strictEqual(game.moves.length,0,'no menu work during gameplay');
 const confirm=fixture(legacy);confirm.button(0,true);confirm.advance(200);
 assert.deepStrictEqual(confirm.moves,[['accept',legacy?166:16]],'legacy debounce only on the old path');
}
for(const [button,action] of [[0,'accept'],[1,'back'],[3,'press'],[8,'press']]) {
 const f=fixture();f.button(button,true);f.advance(16);f.c.LibraryNavigation.viewChanged();
 f.button(button,false);f.advance(32);f.button(button,true);f.advance(48);
 assert.deepStrictEqual(f.moves,[[action,16]],'bouncing press acts once on button '+button);
 f.button(button,false);f.advance(64);f.advance(128);f.button(button,true);f.advance(144);
 assert.deepStrictEqual(f.moves.map(m=>m[1]),[16,144],'stable release re-arms button '+button);
}
const dpadBounce=fixture();dpadBounce.button(15,true);dpadBounce.advance(16);
dpadBounce.button(15,false);dpadBounce.advance(32);dpadBounce.button(15,true);dpadBounce.advance(48);
dpadBounce.advance(400);
assert.deepStrictEqual(dpadBounce.moves.map(m=>m[1]),[16,366],'D-pad bounce resumes the planned repeat');
const dpadView=fixture();dpadView.button(15,true);dpadView.advance(16);dpadView.c.LibraryNavigation.viewChanged();
dpadView.button(15,false);dpadView.advance(32);dpadView.button(15,true);dpadView.advance(48);
dpadView.advance(1000);assert.deepStrictEqual(dpadView.moves,[['right',16]],'held D-pad stays suppressed after a view change');
const dpadAgain=fixture();dpadAgain.button(15,true);dpadAgain.advance(16);
dpadAgain.button(15,false);dpadAgain.advance(32);dpadAgain.advance(100);dpadAgain.button(15,true);dpadAgain.advance(116);
assert.deepStrictEqual(dpadAgain.moves.map(m=>m[1]),[16,112],'stable release re-arms the D-pad');
const dpadOther=fixture();dpadOther.button(15,true);dpadOther.advance(16);
dpadOther.button(15,false);dpadOther.advance(32);dpadOther.button(14,true);dpadOther.advance(48);
assert.deepStrictEqual(dpadOther.moves.map(m=>[m[0],m[1]]),[['right',16],['left',48]],'a new direction is not delayed');
const idle=fixture();idle.advance(10000);assert.strictEqual(idle.moves.length,0);assert.strictEqual(idle.timers.size,1);
const accepting=fixture();accepting.button(0,true);
for(let t=0;t<160;t+=16){accepting.axis(t%32?.79:.81);accepting.advance(t+16);}
accepting.advance(170);assert.deepStrictEqual(accepting.moves,[['accept',16]],'immediate confirm; held noise stays suppressed');
const cancelled=fixture();cancelled.button(0,true);cancelled.advance(20);cancelled.hide();cancelled.show();cancelled.advance(200);
assert.deepStrictEqual(cancelled.moves,[['accept',16]],'confirm is not replayed after hide/show');
for(const context of ['Settings','PCs','AddHostDialog','PairingDialog']) {
 const a=fixture(true),b=fixture();
 for(const f of [a,b]){f.c.ConsoleLibrary.visible=()=>false;f.c.isDialogOpen=context.endsWith('Dialog');}
 for(let t=0;t<800;t+=16)for(const f of [a,b]){f.axis(t%32?.79:.81,.01);f.advance(t+16);}
 assert.strictEqual(a.moves.length,0,context+' baseline analog jitter starvation reproduced');
 assert.deepStrictEqual(b.moves.map(m=>m[1]),[16,366,466,566,666,766],context+' uses shared corrected handler');
 const digitalA=fixture(true),digitalB=fixture();
 for(const f of [digitalA,digitalB]){f.c.ConsoleLibrary.visible=()=>false;f.c.isDialogOpen=context.endsWith('Dialog');f.button(13,true);}
 for(let t=0;t<1000;t+=16)for(const f of [digitalA,digitalB]){f.axis(t%32?.01:.02);f.advance(t+16);}
 assert.strictEqual(digitalA.moves.length,1,context+' baseline D-pad cancellation reproduced');
 assert.strictEqual(digitalB.moves.length,8,context+' D-pad repeat survives analog noise');
}
// Run the production navigation stack too: settings/host/dialog transitions
// must invalidate timers without transferring a held stick to the next view.
const stack=fixture(),navigationSource=read('wasm/platform/navigation.js');
stack.c.LibraryNavigation.reset();
vm.runInContext(navigationSource.slice(navigationSource.indexOf('const Navigation = (function() {'))+
 '\nwindow.realNavigation = Navigation;',stack.c);
const navigation=stack.c.realNavigation;
stack.c.Navigation=navigation;
function view(label){const result={enter(){},leave(){}};
 for(const name of ['up','down','left','right','accept','back','press'])result[name]=()=>stack.moves.push([label+':'+name]);
 return result;
}
const settings=view('Settings'),pairing=view('Pairing'),hosts=view('PCs');
navigation.push(settings);navigation.start();stack.axis(.8);stack.advance(20);
assert.deepStrictEqual(stack.moves,[['Settings:right']]);
navigation.push(pairing);stack.c.isDialogOpen=true;
for(let t=20;t<500;t+=16){stack.axis(t%32?.79:.81);stack.advance(t+16);}
assert.strictEqual(stack.moves.length,1,'held noisy axis cannot leak through push');
stack.axis(0);stack.advance(528);stack.axis(.8);stack.advance(550);
assert.strictEqual(stack.moves.at(-1)[0],'Pairing:right','dialog accepts a new analog press');
navigation.pop();stack.c.isDialogOpen=false;stack.advance(1000);
assert.strictEqual(stack.moves.length,2,'pop cancels held dialog repeat');
stack.axis(0);stack.advance(1024);stack.axis(.8);stack.advance(1040);
const beforeSameView=stack.moves.length;navigation.change(settings);stack.advance(1400);
assert.strictEqual(stack.moves.length,beforeSameView+1,'reentering the same view does not interrupt its repeat');
navigation.change(hosts);stack.advance(1800);
assert.strictEqual(stack.moves.length,beforeSameView+1,'change cancels old view repeat');
stack.axis(0);stack.advance(1824);stack.button(13,true);stack.advance(1840);
assert.strictEqual(stack.moves.at(-1)[0],'PCs:down');
navigation.stop();const stopped=stack.moves.length;stack.axis(.8);stack.advance(2500);
assert.strictEqual(stack.moves.length,stopped);assert.strictEqual(stack.timers.size,1,'stop leaves no navigation work');
navigation.start();stack.axis(0);stack.button(13,false);stack.advance(2528);stack.button(1,true);stack.advance(2700);
assert.strictEqual(stack.moves.at(-1)[0],'PCs:back','confirm/back work after restarting menu navigation');
const crossAction=fixture();crossAction.axis(.8);crossAction.button(0,true);crossAction.advance(200);
crossAction.c.LibraryNavigation.viewChanged();
for(let t=200;t<700;t+=16){crossAction.axis(t%32?.79:.81);crossAction.advance(t+16);}
assert.deepStrictEqual(crossAction.moves,[['accept',16]],'held axis is suppressed after confirming a screen change');
crossAction.axis(0);crossAction.advance(736);crossAction.axis(.8);crossAction.advance(752);
assert.deepStrictEqual(crossAction.moves.at(-1),['right',752]);
// New menu-only controls: filters, pages, help, guide and Nintendo A/B.
{
 const f=fixture();
 let filters=0,pages=[],help=0,guide=0,changes=0;
 const filterNodes={};
 ['All','Favorites','Recent'].forEach((name,index)=>{
  filterNodes['library'+name]={attrs:{'aria-pressed':index===0?'true':'false'},
   getAttribute(name){return this.attrs[name]===undefined?null:this.attrs[name];},
   click(){filters++;Object.keys(filterNodes).forEach(key=>{filterNodes[key].attrs['aria-pressed']=key==='library'+name?'true':'false';});}};
 });
 f.c.document.getElementById=id=>filterNodes[id]||null;
 f.c.Views={Apps:{}};f.c.Navigation.change=()=>{changes++;};
 f.c.ConsoleLibrary.move=(dx,dy)=>pages.push([dx,dy]);
 f.c.ControllerIdentity={familyAt:()=> 'xbox',refreshPlayers(){},localizeGuide(){},setGuideIndex(){}};
 f.c.QuickHelp={toggle(){help++;},open(){help++;},isOpen(){return false;},close(){}};
 f.c.navigationGuideDialog=()=>{guide++;};
 f.button(4,true);f.advance(16);f.button(4,false);f.advance(32);
 f.button(5,true);f.advance(48);f.button(5,false);f.advance(64);
 assert.strictEqual(filters,2,'LB/RB cycle the three library filters');
 assert(changes>=2,'filtering returns to the Apps view');
 f.button(6,true);f.advance(80);f.button(6,false);f.advance(96);
 f.button(7,true);f.advance(112);f.button(7,false);f.advance(128);
 assert.deepStrictEqual(pages.slice(-2),[[0,-2],[0,2]],'LT/RT page by two rows');
 f.pads[0].axes[2]=0.8;f.advance(144);f.pads[0].axes[2]=0;f.advance(160);
 f.pads[0].axes[2]=-0.8;f.advance(176);f.pads[0].axes[2]=0;f.advance(192);
 assert.deepStrictEqual(pages.slice(-2),[[0,2],[0,-2]],'right stick pages once per push');
 f.button(9,true);f.advance(208);f.button(9,false);f.advance(224);
 f.button(16,true);f.advance(240);f.button(16,false);f.advance(256);
 assert.strictEqual(help,1,'Start opens quick help');assert.strictEqual(guide,1,'Guide opens the guide');
 f.c.isDialogOpen=true;
 f.button(4,true);f.advance(272);f.button(4,false);f.advance(288);
 assert.strictEqual(filters,2,'filters are inert while a dialog is open');
 f.c.isDialogOpen=false;
 f.c.ControllerIdentity={familyAt:()=> 'nintendo',refreshPlayers(){},localizeGuide(){},setGuideIndex(){}};
 f.button(0,true);f.advance(304);f.button(0,false);f.advance(320);
 f.button(1,true);f.advance(336);f.button(1,false);f.advance(352);
 assert.deepStrictEqual(f.moves.filter(move=>move[0]==='accept').length,1,'Nintendo physical A accepts');
 assert.deepStrictEqual(f.moves.filter(move=>move[0]==='back').length,1,'Nintendo physical B goes back');
}
// Controller mapping test mode suspends the menu reader; raw input is inert.
{
 const f=fixture();
 f.c.LibraryNavigation.suspend();
 assert.strictEqual(f.c.LibraryNavigation.isSuspended(),true);
 f.button(0,true);f.advance(16);f.button(0,false);f.advance(32);
 assert.strictEqual(f.moves.length,0,'suspended menu ignores raw buttons');
 f.c.LibraryNavigation.resume();
 assert.strictEqual(f.c.LibraryNavigation.isSuspended(),false);
 f.button(0,true);f.advance(48);f.button(0,false);f.advance(64);
 assert.deepStrictEqual(f.moves.map(move=>move[0]),['accept']);
}
// Freeze the historical navigation delta. Only the exact independently tested
// video/refresh patch may differ in subsequent streaming versions.
const normalize=require('./library-navigation-scope.cjs').normalize;
const paths=cp.execFileSync('git',['ls-tree','-r','--name-only','v3.4.8','--',
 'wasm','moonlight-common-c','libgamestream','CMakeLists.txt','res/config.xml'],{encoding:'utf8'}).trim().split('\n')
 .filter(file=>!file.endsWith('_test.js')&&!file.endsWith('.cjs')&&!/_fixture\.(?:c|cpp)$/.test(file)&&file!=='wasm/platform/controller-mapping.js');
assert(!read('CMakeLists.txt').includes('video_recovery_fixture'), 'native fixture stays out of app');
for(const file of paths){
 if(!['wasm/platform/index.js','wasm/platform/gamepad.js','wasm/platform/console-library.js','wasm/platform/messages.js',
  'wasm/platform/navigation.js','wasm/platform/controller-mapping-menu.js','wasm/platform/controller-mapping.js',
  'wasm/main.cpp','wasm/index.html','CMakeLists.txt','res/config.xml'].includes(file)) {
  const transport=require('./video-transport-scope.cjs');
  if(transport.files.includes(file))assert.strictEqual(transport.normalize(file,read(file)),old(file),'exact video/refresh delta: '+file);
  else if(require('./controller-identity-scope.cjs').files.includes(file))
    assert.strictEqual(require('./controller-identity-scope.cjs').normalize(file,read(file)),old(file),'exact tested controller identity delta: '+file);
  else if(file==='wasm/platform/remote_controller.js')
    assert.strictEqual(require('./stage5-scope.cjs').normalize(file,read(file)),old(file),'exact Stage 5 remote cleanup');
  else if(file==='wasm/platform/app-lifecycle.js'||file==='wasm/static/js/utils.js')
    assert.strictEqual(require('./stream-return-scope.cjs').normalize(file,read(file)),old(file),'exact tested stop-to-menu delta: '+file);
  else if(file==='wasm/http.cpp')
    assert.strictEqual(require('./session-transition-scope.cjs').normalize(file,read(file)),old(file),'exact tested host-quit deadline only');
  else if (require('./frame-pacing-scope.cjs').files.includes(file))
    assert.strictEqual(require('./frame-pacing-scope.cjs').normalize(file,read(file)),old(file),'exact optional pacing integration: '+file);
  else assert.deepStrictEqual(require('./branding-scope.cjs').asset(file,fs.readFileSync(file)),cp.execFileSync('git',['show','v3.4.8:'+file]),'unchanged runtime bytes or exact approved icon: '+file);
  continue;
 }
 let current=normalize(file,read(file)),base=old(file);
 if(file==='CMakeLists.txt')current=current.replace('project(MoonlightWasm VERSION 3.4.10)','project(MoonlightWasm VERSION 3.4.8)').replace('project(MoonlightWasm VERSION 3.4.9)','project(MoonlightWasm VERSION 3.4.8)');
 if(file==='res/config.xml')current=current.replace(' version="3.4.10"',' version="3.4.8"').replace(' version="3.4.9"',' version="3.4.8"');
 assert.strictEqual(current,base,'runtime frozen outside library hooks: '+file);
}
for(const [file,from,to]of [
 ['wasm/platform/index.js','LibraryNavigation.handle(e.detail);','LibraryNavigation.handle(null);'],
 ['wasm/platform/gamepad.js','setInterval(pollGamepads, 16)','setInterval(pollGamepads, 32)'],
 ['wasm/platform/console-library.js','epoch++;','epoch+=2;'],
 ['wasm/platform/navigation.js','viewStack.push(view);','viewStack.push(null);']]){
 assert.notStrictEqual(normalize(file,read(file).replace(from,to)),old(file),'neighboring mutation rejected');
}
console.log('library_navigation_test: real polling/listener and view stack; library/Settings/PCs/add-PC/pairing corrected, 350/100 ms single timer, hysteresis, button/D-pad bounce gate with preserved repeat cadence, reversal, two pads, modal transitions/held-axis suppression, stale callbacks, confirm/back, Nintendo A/B, LB/RB filters, LT/RT/right-stick pages, Start/Guide help, stop/start and frozen gameplay PASS (synthetic timing, not TV latency)');

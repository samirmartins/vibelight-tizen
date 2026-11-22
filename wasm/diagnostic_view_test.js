'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
function fixture(records){
  let active=null;const roots={};
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.value='';this.listeners={};}
    addEventListener(name,fn){(this.listeners[name]=this.listeners[name]||[]).push(fn);}
    set textContent(value){this.value=String(value);this.children=[];}
    get textContent(){return this.value+this.children.map(n=>n.textContent).join('');}
    appendChild(node){this.children.push(node);return node;}
    setAttribute(key,value){this.attributes[key]=value;}
    focus(){active=this;}
    // The app's own activation is a synthetic click; the browser's extra click after the OK key is trusted.
    // Capture listeners of the dialog run first, as in a real page.
    click(trusted=false){
      if(this.disabled)return;
      const event={type:'click',isTrusted:!!trusted,target:this,stopped:false,stopImmediatePropagation(){this.stopped=true;},preventDefault(){}};
      if(this!==roots.diagnosisDialog)for(const fn of roots.diagnosisDialog.listeners.click||[])fn(event);
      if(event.stopped)return;
      if(this.onclick)this.onclick(event);
    }
    querySelectorAll(){const found=[];function walk(n){if(n.tagName==='BUTTON'&&!n.disabled)found.push(n);n.children.forEach(walk);}this.children.forEach(walk);return found;}
  }
  for(const id of ['diagnosisDialog','diagnosisTitle','diagnosisConfig','diagnosisDevice','diagnosisRows','diagnosisList','diagnosisPrivacy','diagnosisFinding','diagnosisHints','diagnosisPeak','diagnosisFoot','diagnosisActions'])roots[id]=new Element();
  roots.diagnosisDialog.children=Object.values(roots).filter(n=>n!==roots.diagnosisDialog);
  const find=id=>roots[id] || roots.diagnosisDialog.querySelectorAll().find(n=>n.id===id);
  const storage=new Map(),calls=[];
  const clock={now:1000};
  const c={isInGame:false,isDialogOpen:false,performance:{now:()=>clock.now},document:{getElementById:find,createElement:tag=>new Element(tag)},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    Views:{UtilityDialog:{controls:[],view:{index:0}}},
    snackbarLogLong:text=>calls.push(text),
    openUtilityDialog(id,ids,closeId){roots[id].open=true;c.isDialogOpen=true;c.Views.UtilityDialog.controls=ids;c.Views.UtilityDialog.closeId=closeId;find(ids[0]).focus();},
    closeUtilityDialog(id){roots[id].open=false;c.isDialogOpen=false;},
    fetch(){throw Error('view sent a request');},XMLHttpRequest(){throw Error('view sent a request');},
    setTimeout(){throw Error('view started a collector');},Module:{setDiagnostics(){throw Error('view started native collection');}}};
  vm.createContext(c);
  for(const name of ['diagnostic-history','diagnostic-hints','diagnostic-view'])vm.runInContext(fs.readFileSync('wasm/platform/'+name+'.js','utf8'),c);
  storage.set(c.DiagnosticHistory.key,JSON.stringify({version:2,records}));
  // What the browser does after the app handled the OK key: click the element that is focused now.
  return {c,find,roots,calls,clock,focus:()=>active&&active.id,defaultClick:()=>active&&active.click(true)};
}
const record=(id,config={})=>({version:2,id:String(id),createdAt:1700000000000+id,durationMs:120000,recordedMs:60000,
  game:'Artificial game '+id,device:'Synthetic TV · Tizen 9',
  config:{version:'4.0.2',variant:'ForceGM',pacing:true,hdr:false,gameMode:false,bitrate:30,audio:'Stereo',audioLimitMs:100,stream:'1920×1080 H264 60fps',...config},
  metrics:{fpsReceived:60},rows:[['FPS','60']],details:[['Clock','--']]});
let failures=0;
function check(name,run){try{run();}catch(error){failures++;console.error(name+': '+error.message);}}
check('saved context',()=>{
  const f=fixture([record(1,{audio:'51Surround'})]);f.c.DiagnosticView.latest();
  const text=f.roots.diagnosisConfig.textContent+' '+f.roots.diagnosisDevice.textContent;
  for(const part of ['4.0.2','ForceGM','Frame pacing: On','HDR: Off','100 ms','30 Mbps','5.1 Surround Sound'])assert(text.includes(part),'missing '+part);
});
check('comparison configuration values',()=>{
  const f=fixture([record(2),record(1,{pacing:false,bitrate:40,audioLimitMs:60})]);
  f.c.DiagnosticView.history();f.find('diagnosis-record-0').click();f.find('diagnosis-record-1').click();
  f.find('diagnosisCompare').click();
  const a=f.roots.diagnosisConfig.textContent,b=f.roots.diagnosisDevice.textContent;
  for(const part of ['4.0.2','ForceGM','Frame pacing: On','30 Mbps','100 ms'])assert(a.includes(part),'A missing '+part);
  for(const part of ['Frame pacing: Off','40 Mbps','60 ms'])assert(b.includes(part),'B missing '+part);
});
check('return focus',()=>{
  const f=fixture([record(2),record(1)]);
  f.c.DiagnosticView.history();f.find('diagnosis-record-0').click();f.find('diagnosis-record-1').click();
  f.find('diagnosisCompare').click();
  f.find('diagnosisClose').click();assert.equal(f.focus(),'diagnosisCompare','Back from the comparison returns to the Compare button');
  f.find('diagnosis-record-0').click();f.find('diagnosisViewSelected').click();f.find('diagnosisDetails').click();
  f.find('diagnosisClose').click();f.find('diagnosisClose').click();assert.equal(f.focus(),'diagnosis-record-0');
});
check('empty, legacy and unavailable fields',()=>{
  const f=fixture([]);f.c.DiagnosticView.history();assert.match(f.roots.diagnosisFinding.textContent,/No saved diagnosis/);
  const legacy=record(1);legacy.legacy=true;legacy.config={};
  const g=fixture([legacy]);g.c.DiagnosticView.latest();
  assert(!g.roots.diagnosisDevice.textContent.includes('4.0.2'),'legacy data cannot inherit the running version');
});
// Suggestions come only from the stored summaries and only when a record or comparison is opened.
const long=(id,metrics={},config={},game='Artificial game '+id)=>({...record(id,config),game,recordedMs:300000,durationMs:300000,nativeMs:300000,
  metrics:{lossPercent:0.1,rttVariation:2,audioUnderruns:0,audioOverruns:0,clientRejects:0,browserDrops:0,...metrics}});
const GAPS='Frame gaps reached 2%. This often points to network loss. A wired connection or 5 GHz Wi-Fi may help; a lower bitrate can reduce gaps at the cost of image detail.';
check('suggestion in a saved record',()=>{
  const f=fixture([long(1,{lossPercent:2})]);f.c.DiagnosticView.latest();
  assert.equal(f.roots.diagnosisHints.textContent,GAPS);
  f.find('diagnosisDetails').click();
  assert.equal(f.roots.diagnosisHints.textContent,'','technical details carry no suggestion');
  f.find('diagnosisClose').click();
  assert.equal(f.roots.diagnosisHints.textContent,GAPS,'back on the record the suggestion returns');
});
check('several suggestions, one per line',()=>{
  const f=fixture([long(1,{lossPercent:2,rttVariation:12})]);f.c.DiagnosticView.latest();
  const lines=f.roots.diagnosisHints.textContent.split('\n');
  assert.equal(lines.length,2);
  assert(lines[0].startsWith('Frame gaps reached 2%.') && lines[1].startsWith('Network latency varied by 12 ms.'));
});
check('stable recording says nothing needs changing',()=>{
  const f=fixture([long(1)]);f.c.DiagnosticView.latest();
  assert.equal(f.roots.diagnosisHints.textContent,'No problem found in this recording. There is nothing to adjust.');
});
check('no suggestion for short, partial-data or legacy records',()=>{
  const short=fixture([record(1)]);short.c.DiagnosticView.latest();assert.equal(short.roots.diagnosisHints.textContent,'');
  const legacy=record(1);legacy.legacy=true;legacy.config={};
  const old=fixture([legacy]);old.c.DiagnosticView.latest();assert.equal(old.roots.diagnosisHints.textContent,'');
  const list=fixture([long(1,{lossPercent:9})]);list.c.DiagnosticView.history();
  assert.equal(list.roots.diagnosisHints.textContent,'','the history list shows none');
});
check('comparison suggestion by bitrate',()=>{
  const f=fixture([long(2,{lossPercent:2},{bitrate:80},'Same game'),long(1,{lossPercent:0.2},{bitrate:50},'Same game')]);
  f.c.DiagnosticView.history();f.find('diagnosis-record-0').click();f.find('diagnosis-record-1').click();
  f.find('diagnosisCompare').click();
  assert.equal(f.roots.diagnosisHints.textContent,'With 80 Mbps frame gaps reached 2%; with 50 Mbps they were 0.2%. The lower bitrate gives less image detail.');
  f.find('diagnosisClose').click();
  assert.equal(f.roots.diagnosisHints.textContent,'','leaving the comparison clears it');
  const other=fixture([long(2,{lossPercent:2},{bitrate:80}),long(1,{lossPercent:0.2},{bitrate:50})]);   // different games
  other.c.DiagnosticView.history();other.find('diagnosis-record-0').click();other.find('diagnosis-record-1').click();
  other.find('diagnosisCompare').click();
  assert.equal(other.roots.diagnosisHints.textContent,'');
  const same=fixture([long(2,{lossPercent:2},{bitrate:50},'Same game'),long(1,{lossPercent:0.2},{bitrate:50},'Same game')]);
  same.c.DiagnosticView.history();same.find('diagnosis-record-0').click();same.find('diagnosis-record-1').click();
  same.find('diagnosisCompare').click();
  assert.equal(same.roots.diagnosisHints.textContent,'');
});
check('the view stays offline and inert',()=>{
  // The fixture throws on fetch, XMLHttpRequest, setTimeout and native collection.
  const f=fixture([long(1,{lossPercent:2}),long(2,{lossPercent:0.1},{bitrate:20})]);
  f.c.DiagnosticView.history();f.find('diagnosis-record-0').click();f.find('diagnosis-record-1').click();f.find('diagnosisCompare').click();
});
// The TV remote's OK is handled by the app and then clicked again by the browser on the element that is focused
// by then (the re-rendered one). That second click must neither undo a selection nor press the next button.
const pick=(f,index)=>{f.find('diagnosis-record-'+index).click();f.defaultClick();};
check('one OK press selects one record',()=>{
  const f=fixture([long(2),long(1)]);f.c.DiagnosticView.history();
  pick(f,0);
  assert.equal(f.find('diagnosis-record-0').attributes['aria-pressed'],'true','the record stays selected');
  assert.match(f.roots.diagnosisFinding.textContent,/^1 \/ 2/);
  pick(f,1);
  assert.match(f.roots.diagnosisFinding.textContent,/^2 \/ 2/,'two records can be selected with OK');
});
check('OK on Compare opens the comparison and stays there',()=>{
  const f=fixture([long(2),long(1)]);f.c.DiagnosticView.history();pick(f,0);pick(f,1);
  f.find('diagnosisCompare').click();f.defaultClick();
  assert.equal(f.roots.diagnosisTitle.textContent,'Compare diagnoses','Back must not be pressed by the browser click');
});
check('OK on View selected stays on the record',()=>{
  const f=fixture([long(2),long(1)]);f.c.DiagnosticView.history();pick(f,0);
  f.find('diagnosisViewSelected').click();f.defaultClick();
  assert.equal(f.roots.diagnosisTitle.textContent,'Last diagnosis','Technical details must not open by itself');
});
check('real mouse clicks and spaced presses still work',()=>{
  const f=fixture([long(2),long(1)]);f.c.DiagnosticView.history();
  f.find('diagnosis-record-0').click(true);                        // a mouse click, nothing before it
  assert.equal(f.find('diagnosis-record-0').attributes['aria-pressed'],'true');
  f.clock.now+=1000;f.find('diagnosis-record-1').click(true);
  assert.equal(f.find('diagnosis-record-1').attributes['aria-pressed'],'true');
  f.clock.now+=1000;f.find('diagnosis-record-1').click();f.defaultClick();   // a later OK press deselects once
  assert.equal(f.find('diagnosis-record-1').attributes['aria-pressed'],'false');
});
check('selecting the second record moves focus to Compare',()=>{
  const f=fixture([long(3),long(2),long(1)]);f.c.DiagnosticView.history();
  pick(f,0);
  assert.equal(f.focus(),'diagnosis-record-0','one record: focus stays on the list');
  f.clock.now+=1000;pick(f,2);
  assert.equal(f.focus(),'diagnosisCompare','two records: the next step is Compare');
  f.clock.now+=1000;
  f.find('diagnosis-record-2').click();                     // deselecting goes back to one record
  assert.equal(f.focus(),'diagnosis-record-2','after deselecting, focus stays on that record');
  assert.equal(f.find('diagnosisCompare'),undefined,'Compare is disabled with one record');
});
check('two quick mouse clicks both count',()=>{
  const f=fixture([long(3),long(2),long(1)]);f.c.DiagnosticView.history();
  f.find('diagnosis-record-0').click(true);f.find('diagnosis-record-2').click(true);   // no time between two real clicks
  assert.match(f.roots.diagnosisFinding.textContent,/^2 \/ 2/,'a real click is never the echo of a handled one');
});
if(failures)process.exitCode=1;
else console.log('diagnostic_view_test: saved configuration, A/B values, return focus, legacy and offline consultation, local suggestions PASS');

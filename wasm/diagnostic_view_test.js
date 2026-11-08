'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
function fixture(records){
  let active=null;const roots={};
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.value='';}
    set textContent(value){this.value=String(value);this.children=[];}
    get textContent(){return this.value+this.children.map(n=>n.textContent).join('');}
    appendChild(node){this.children.push(node);return node;}
    setAttribute(key,value){this.attributes[key]=value;}
    focus(){active=this;}
    click(){if(!this.disabled && this.onclick)this.onclick();}
    querySelectorAll(){const found=[];function walk(n){if(n.tagName==='BUTTON'&&!n.disabled)found.push(n);n.children.forEach(walk);}this.children.forEach(walk);return found;}
  }
  for(const id of ['diagnosisDialog','diagnosisTitle','diagnosisConfig','diagnosisDevice','diagnosisRows','diagnosisList','diagnosisPrivacy','diagnosisFinding','diagnosisPeak','diagnosisFoot','diagnosisActions'])roots[id]=new Element();
  roots.diagnosisDialog.children=Object.values(roots).filter(n=>n!==roots.diagnosisDialog);
  const find=id=>roots[id] || roots.diagnosisDialog.querySelectorAll().find(n=>n.id===id);
  const storage=new Map(),calls=[];
  const c={isInGame:false,isDialogOpen:false,document:{getElementById:find,createElement:tag=>new Element(tag)},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    Views:{UtilityDialog:{controls:[],view:{index:0}}},
    snackbarLogLong:text=>calls.push(text),
    openUtilityDialog(id,ids,closeId){roots[id].open=true;c.isDialogOpen=true;c.Views.UtilityDialog.controls=ids;c.Views.UtilityDialog.closeId=closeId;find(ids[0]).focus();},
    closeUtilityDialog(id){roots[id].open=false;c.isDialogOpen=false;},
    fetch(){throw Error('view sent a request');},XMLHttpRequest(){throw Error('view sent a request');},
    setTimeout(){throw Error('view started a collector');},Module:{setDiagnostics(){throw Error('view started native collection');}}};
  vm.createContext(c);
  for(const name of ['diagnostic-history','diagnostic-view'])vm.runInContext(fs.readFileSync('wasm/platform/'+name+'.js','utf8'),c);
  storage.set(c.DiagnosticHistory.key,JSON.stringify({version:2,records}));
  return {c,find,roots,calls,focus:()=>active&&active.id};
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
  f.find('diagnosisClose').click();assert.equal(f.focus(),'diagnosis-record-1','Back restores the last selected row');
  f.find('diagnosis-record-0').click();f.find('diagnosisViewSelected').click();f.find('diagnosisDetails').click();
  f.find('diagnosisClose').click();f.find('diagnosisClose').click();assert.equal(f.focus(),'diagnosis-record-0');
});
check('empty, legacy and unavailable fields',()=>{
  const f=fixture([]);f.c.DiagnosticView.history();assert.match(f.roots.diagnosisFinding.textContent,/No saved diagnosis/);
  const legacy=record(1);legacy.legacy=true;legacy.config={};
  const g=fixture([legacy]);g.c.DiagnosticView.latest();
  assert(!g.roots.diagnosisDevice.textContent.includes('4.0.2'),'legacy data cannot inherit the running version');
});
if(failures)process.exitCode=1;
else console.log('diagnostic_view_test: saved configuration, A/B values, return focus, legacy and offline consultation PASS');

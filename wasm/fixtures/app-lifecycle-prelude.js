// Shared harness: production lifecycle and launcher (startGame) on top of the
// startup harness, with controllable launch/resume replies.
'use strict';
// Production menu/lifecycle/launcher code with bounded, controllable browser
// events and HTTP replies. This is not a Samsung EMSS or real-TV emulator.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),cp=require('child_process');
const lifecycle=fs.readFileSync('wasm/platform/app-lifecycle.js','utf8');
const index=fs.readFileSync('wasm/platform/index.js','utf8');
const launcher=index.slice(index.indexOf('function startGame('),index.indexOf('// Stop the running app title'));
assert(launcher.startsWith('function startGame(')&&launcher.includes('sendMessage(\'startRequest\''));
const setup=fs.readFileSync('wasm/fixtures/startup-app-prelude.js','utf8');
const harness={require,console};vm.createContext(harness);
vm.runInContext(setup+'\nglobalThis.makeFixture=fixture;',harness);
function fixture(options={}) {
 const f=harness.makeFixture(options),c=f.c,events={},log=[];
 c.document.hidden=!!options.hidden;
 c.document.addEventListener=(name,fn)=>{assert(!events[name]);events[name]=fn;};
 c.api=f.host;c.activePolls={};c.hostPollScopes={};c.hostOpenRequest={};
 c.startupScanTimer=c.repeatTimeout=c.navigationTimeout=0;c.repeatAction=()=>{};
 for(const name of ['stopPollingHosts','startPollingHosts','stopSubnetScanner','stopDisplayRefreshEstimator',
  'startDisplayRefreshEstimator','stopVideoPresentationObserver','stopGamepadSnapshot']) c[name]=()=>log.push(name);
 c.Controller={stopWatching(){log.push('controller stop');},startWatching(){log.push('controller start');}};
 Object.assign(c.Navigation,{stop(){log.push('nav stop');},start(){log.push('nav start');},switch(){log.push('nav switch');},pop(){log.push('nav pop');}});
 c.WakeHost.cancel=()=>log.push('wake cancel');
 c.SessionDiagnostics={configure(){},finish(){log.push('diagnosis finish');}};
 c.showApps=host=>{log.push('menu');return c.ConsoleLibrary.open(host);};
 c.Module={stopStream(){log.push('native stop');c.AppLifecycle.deferMenu(c.api);}};
 f.node('quitAppDialog').close=function(){this.open=false;};
 vm.runInContext(lifecycle,c);
 f.visibility=hidden=>{c.document.hidden=hidden;events.visibilitychange();};
 return Object.assign(f,{log});
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function realLauncher(f,stage,resume=false,source=launcher) {
 const c=f.c,gate=deferred(),calls=[];
 const q=selector=>({off(){return this;},on(){return this;},children(){return this;},show(){return this;},hide(){return this;},
  data(){return ({'#selectResolution':'1920:1080','#selectFramerate':60,'#selectAudio':2,'#selectCodec':'H264'})[selector];},
  val(){return selector==='#jitterSlider'?'100':'30';},
  parent(){return this;},hasClass(){return false;},css(){return this;},text(...args){return args.length?this:'fixture';},find(){return this;},
  attr(name){return name==='status_code'?'200':'';}});
 c.$=q;c.$.parseXML=()=>'';
 c.prepareStreamAudio=()=>calls.push('audio');c.startAudioScheduler=()=>calls.push('scheduler');
 c.generateRemoteInputKey=()=> 'synthetic-key';c.generateRemoteInputKeyId=()=>123;
 c.getConnectedGamepadMask=()=>1;c.getDisplayRefreshRateX100=()=>6000;c.setDisplayStreamReference=()=>{};
 c.showStreamMode=()=>{c.isInGame=true;c.ConsoleLibrary.suspend();};
 c.sendMessage=(kind,args)=>{calls.push({kind,args});return Promise.resolve();};
 c.snackbarLog=c.snackbarLogLong=()=>calls.push('snackbar');
 f.host.currentGame=resume?2:0;
 f.host.refreshServerInfo=()=>stage==='refresh'?gate.promise:Promise.resolve();
 f.host.getAppById=()=>stage==='app'?gate.promise:Promise.resolve({id:2,title:'Example Game'});
 f.host.resumeApp=f.host.launchApp=()=>{calls.push(resume?'resume':'launch');return stage==='result'?gate.promise:Promise.resolve('xml');};
 vm.runInContext(source,c);
 return {gate,calls};
}

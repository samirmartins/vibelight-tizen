'use strict';
// Production console library (wasm/platform/console-library.js) in a VM with a
// fake DOM, host, storage, timers and cancellable cover requests.
const fs = require('fs'), vm = require('vm');
const file = 'wasm/platform/console-library.js', source = fs.readFileSync(file, 'utf8');
function fixture(count = 4, coverUrl, options = {}) {
  const all = [], nodes = new Map(), timers = new Map(), calls = [], io = {deletes:0,reloads:0};
  let timerId = 0, serial = 0;
  const mutations = {classes:0,tabs:0};
  class Element {
    constructor(tag, root = false) {
      this.tag = tag; this.root = root; this.children = []; this.dataset = {}; this.style = {};
      this.id = ''; this.className = ''; this._text = ''; this.disabled = false;
      const classes = new Set();
      this.classList = {add(value){classes.add(value);},remove(value){classes.delete(value);},
        contains(value){return classes.has(value);},toggle(value,on){mutations.classes++;if(on)classes.add(value);else classes.delete(value);}};
      all.push(this);
    }
    get isConnected() { return this.root || !!(this.parent && this.parent.isConnected); }
    get parentNode() { return this.parent || null; }
    get tabIndex() { return this._tabIndex === undefined ? 0 : this._tabIndex; }
    set tabIndex(value) { mutations.tabs++;this._tabIndex=value; }
    get textContent() { return this._text; }
    set textContent(value) { this.children.forEach(n => n.parent = null); this.children = []; this._text = value; }
    appendChild(node) {
      if (node.tag === 'fragment') { node.children.slice().forEach(n => this.appendChild(n)); return node; }
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      this.children.push(node); node.parent = this; return node;
    }
    querySelector(selector) {
      for (const n of this.children) {
        if (selector === n.tag || selector === '.' + n.className) return n;
        const nested = n.querySelector(selector); if (nested) return nested;
      }
      return null;
    }
    setAttribute(name, value) { this[name] = value; }
    scrollIntoView() {}
    click() { if (!this.disabled && this.onclick) this.onclick(); }
  }
  function node(name) {
    if (!nodes.has(name)) { const n = new Element('div', true); n.id = name; nodes.set(name, n); }
    return nodes.get(name);
  }
  const apps = Array.from({length:count}, (_, i) => ({id:i+1,title:'Game '+String(i+1).padStart(3,'0')}));
  const record = {apps, favorites:[], recent:[], focus:1};
  const storage = options.storage || new Map([['moonlight.console.v1', JSON.stringify({preferred:'fixture-pc',hosts:{'fixture-pc':record}})]]);
  const writes=[];
  const host = {serverUid:'fixture-pc',hostname:'Fixture PC',online:true,paired:true,currentGame:0,_memCachedApplist:apps,
    connect(){return this.online ? Promise.resolve('fixture.invalid') : Promise.reject(Error('offline'));},
    getAppListWithCacheFlush(){return Promise.resolve(apps);},
    getBoxArt(appId, scope, offline, force){
      calls.push({appId,scope,offline,force});
      if (host.delay) return new Promise(resolve => host.delay.push(resolve));
      return Promise.resolve(coverUrl ? coverUrl(appId) : 'data:image/png;base64,fixture-'+appId+'-'+serial);
    }};
  const c = {console:{log(){},warn(){},error(){}},Promise,Blob,
    atob:typeof atob==='function'?atob:undefined,btoa:typeof btoa==='function'?btoa:undefined,navigator:{},isInGame:false,isDialogOpen:false,
    hosts:{'fixture-pc':host},Views:{Apps:{},AppsNav:{}},
    document:{hidden:false,getElementById(id){return nodes.get(id) || all.find(n=>n.id===id && n.isConnected) || (id.startsWith('game-container-') ? null : node(id));},
      createElement(tag){return new Element(tag);},createDocumentFragment(){return new Element('fragment');},body:node('body')},
    location:{reload(){io.reloads++;}},
    localStorage:{getItem(k){return storage.has(k)?storage.get(k):null;},removeItem(k){storage.delete(k);},setItem(k,v){writes.push({key:k,value:String(v)});if(options.fail&&options.fail(k))throw Error('Synthetic storage failure');storage.set(k,String(v));}},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);},
    $(){return {children(){return this;},show(){},hide(){}};},
    Navigation:{change(){},start(){},pop(){}},focusElement(){},getComputedStyle(){return {gridTemplateColumns:'1fr 1fr'};},
    showAppsMode(){c.isInGame=false;},stopPollingHosts(){},stopSubnetScanner(){},showHosts(){},stopAudioScheduler(){},
    normalizeWakeMac(v){return v;},snackbarLog(){},exitAppDialog(){},WakeHost:{open(){}},
    startGame(){c.isInGame=true;c.ConsoleLibrary.suspend();},
    tizen:{filesystem:{deleteDirectory(){io.deletes++;}}}};
  c.window = c; vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/menu-tools.js','utf8').split('function openUtilityDialog')[0], c);
  vm.runInContext(fs.readFileSync('wasm/static/js/utils.js','utf8'), c);
  vm.runInContext(options.source || source, c);
  const flush = async()=>{for(let i=0;i<300;i++)await Promise.resolve();};
  async function open() { c.isInGame=false; await c.ConsoleLibrary.open(host); await flush(); }
  function suspend() { c.isInGame=true;c.ConsoleLibrary.suspend(); }
  return {c,node,apps,host,calls,timers,io,flush,open,suspend,storage,writes,mutations,
    card(id){return c.document.getElementById('game-container-'+id);},revision(){serial++;}};
}
module.exports = {fixture};

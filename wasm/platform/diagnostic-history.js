// Bounded local summaries. No network, timers or storage reads on script load.
var DiagnosticHistory = (function() {
  'use strict';
  var key = 'vibelight.diagnosticHistory.v2', legacyKey = 'moonlight.diagnosticReport.v1';
  var limit = 10, maximumBytes = 32768;
  function finite(n) { return typeof n === 'number' && isFinite(n); }
  function failure(error) { return {ok:false, records:[], error:error}; }
  function rows(value) {
    return Array.isArray(value) && value.length <= 40 && value.every(function(r) {
      return Array.isArray(r) && r.length === 2 && r.every(function(s) { return typeof s === 'string' && s.length <= 1800; });
    });
  }
  function valid(record) {
    if (!record || record.version !== 2 || typeof record.id !== 'string' || !record.id || record.id.length > 100 ||
        !finite(record.createdAt) || !finite(record.durationMs) || record.durationMs < 0 ||
        !finite(record.recordedMs) || record.recordedMs < 0 || !rows(record.rows) ||
        !rows(record.details) || !record.config || typeof record.config !== 'object' ||
        Array.isArray(record.config) || Object.keys(record.config).length>30 ||
        !Object.keys(record.config).every(function(k){var v=record.config[k];return v===null || typeof v==='boolean' || finite(v) || (typeof v==='string' && v.length<=600);}) || !record.metrics || typeof record.metrics !== 'object' ||
        Array.isArray(record.metrics) || Object.keys(record.metrics).length > 150) return false;
    if (!Object.keys(record.metrics).every(function(k) { return record.metrics[k] === null || finite(record.metrics[k]); })) return false;
    try { return JSON.stringify(record).length <= maximumBytes; } catch (e) { return false; }
  }
  function create(storage) {
    if(arguments.length===0){try{storage=localStorage;}catch(e){storage=null;}}
    function list() {
      try {
        var raw = storage.getItem(key);
        if (raw !== null) {
          if (raw.length > maximumBytes * limit + 2048) return failure('invalid');
          var envelope = JSON.parse(raw);
          if (!envelope || envelope.version !== 2 || !Array.isArray(envelope.records) ||
              envelope.records.length > limit || !envelope.records.every(valid) ||
              new Set(envelope.records.map(function(r) { return r.id; })).size !== envelope.records.length) return failure('invalid');
          return {ok:true, records:envelope.records};
        }
        var old = storage.getItem(legacyKey);
        if (!old) return {ok:true,records:[]};
        if (old.length > maximumBytes) return failure('legacy-invalid');
        var legacy = JSON.parse(old);
        if (!legacy || !rows(legacy.rows)) return failure('legacy-invalid');
        var migrated = {version:2,id:'legacy-v1',createdAt:0,durationMs:0,recordedMs:0,
          legacy:true,title:String(legacy.title || 'Last diagnosis').slice(0,200),
          config:{},metrics:{},rows:legacy.rows,details:[],
          legacyConfig:String(legacy.config || '').slice(0,500),
          device:String(legacy.device || '').slice(0,300),finding:String(legacy.finding || '').slice(0,600),
          peak:String(legacy.peak || '').slice(0,500),foot:String(legacy.foot || '').slice(0,500)};
        if (!valid(migrated)) return failure('legacy-invalid');
        storage.setItem(key,JSON.stringify({version:2,records:[migrated]}));
        return {ok:true,records:[migrated]};
      } catch (e) { return failure('storage'); }
    }
    function save(record) {
      if (!valid(record)) return failure('invalid-record');
      var previous = list();
      if (!previous.ok) return previous;
      if (previous.records.some(function(r) { return r.id === record.id; })) return previous;
      var records = [record].concat(previous.records).slice(0,limit);
      try {
        // localStorage replacement is atomic: a failed write preserves the old list.
        storage.setItem(key,JSON.stringify({version:2,records:records}));
        return {ok:true,records:records};
      } catch (e) { return failure('storage'); }
    }
    return {list:list,save:save};
  }
  // Values and units are shared by history comparison and report rendering.
  var fields = [
    ['fpsHost','PC FPS','FPS'],['fpsReceived','Received FPS','FPS'],
    ['fpsSubmitted','Player FPS','FPS'],['fpsPresented','Browser FPS','FPS'],
    ['bitrate','Received bitrate','Mbps'],['presentP95','Presentation interval p95','ms'],
    ['presentMax','Worst presentation interval','ms'],['rtt','Network RTT','ms'],
    ['rttVariation','RTT variation','ms'],['lossPercent','Frame gaps','%'],
    ['clientRejects','Client rejections','/min',true],['browserDrops','Browser drops','/min',true],
    ['hostProcessing','PC processing mean','ms'],['hostProcessingMax','PC processing max','ms'],
    ['assembly','Frame assembly mean','ms'],['append','Player submission mean','ms'],
    ['audioQueue','Audio buffer mean','ms'],['audioTarget','Audio target mean','ms'],
    ['audioUnderruns','Audio underruns','/min',true],['audioOverruns','Audio overruns','/min',true],
    ['recoveries','Video recoveries','/min',true],['waits','Video waits','/min',true],
    ['warnings','Warnings','/min',true],['errors','Errors','/min',true]
  ];
  function value(record, field) {
    var n = record && record.metrics && record.metrics[field[0]];
    if (!finite(n) || record.legacy) return null;
    return field[3] ? (record.recordedMs > 0 ? n * 60000 / record.recordedMs : null) : n;
  }
  function compare(a,b) {
    if (!a || !b || a.id === b.id) throw Error('Two distinct records required');
    return fields.map(function(field) {
      var av = value(a,field), bv = value(b,field);
      return {key:field[0],label:field[1],unit:field[2],a:av,b:bv,
        delta:av === null || bv === null ? null : bv-av,
        countA:field[3] && a.metrics ? a.metrics[field[0]] : null,
        countB:field[3] && b.metrics ? b.metrics[field[0]] : null};
    });
  }
  function selection() {
    var ids=[];
    return {ids:function() { return ids.slice(); },clear:function() { ids=[]; },toggle:function(id) {
      var i=ids.indexOf(id);
      if (i>=0) { ids.splice(i,1); return true; }
      if (ids.length===2) return false;
      ids.push(id); return true;
    }};
  }
  return {key:key,legacyKey:legacyKey,create:create,valid:valid,compare:compare,fields:fields,selection:selection};
})();
if (typeof module !== 'undefined' && module.exports) module.exports=DiagnosticHistory;

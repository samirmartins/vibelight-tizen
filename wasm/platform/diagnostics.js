// Opt-in session diagnostics. OFF: no timer, observer, resource query, sample
// buffer or native collection. Local history is read only on user request.
var SessionDiagnostics = (function() {
  var session = null;
  var serial = 0;
  var report = null;
  var lifecycle = null;
  var visible = false;
  var lastWindow = null;
  function store() { return DiagnosticHistory.create(); }
  function checked(id) { var n=document.getElementById(id); return !!(n && n.checked); }
  function text(id) { var n=document.getElementById(id); return n ? String(n.textContent || '') : ''; }
  function tr(s) { return typeof MenuI18n !== 'undefined' ? MenuI18n.text(s) : s; }
  function number(value) { return typeof value === 'number' && isFinite(value); }
  function fmt(value, digits) { return number(value) ? value.toFixed(digits === undefined ? 1 : digits) : '--'; }
  function seconds(ms) { return fmt(ms / 1000, 0) + 's'; }
  function measure(s, key, value, weight) {
    if (!number(value)) return;
    var m = s.metrics[key] || (s.metrics[key] = { sum: 0, weight: 0, min: value, max: value });
    m.sum += value * weight; m.weight += weight;
    m.min = Math.min(m.min, value); m.max = Math.max(m.max, value);
  }
  function average(s, key) { var m = s.metrics[key]; return m && m.weight ? m.sum / m.weight : null; }
  function maximum(s, key) { return s.metrics[key] ? s.metrics[key].max : null; }
  function trend(s, key) {
    function mean(list) {
      var sum = 0, weight = 0;
      list.forEach(function(w) {
        if (number(w[key])) { sum += w[key] * w.ms; weight += w.ms; }
      });
      return weight ? sum / weight : null;
    }
    return fmt(mean(s.first)) + '→' + fmt(mean(s.last));
  }
  function quality(video) {
    try {
      var q = typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null;
      var dropped = q ? q.droppedVideoFrames : video.webkitDroppedFrameCount;
      return number(dropped) && dropped >= 0 ? dropped : null;
    } catch (error) { return null; }
  }
  function readAudio(s) {
    if (typeof _audRefreshStats !== 'function') return;
    _audRefreshStats();
    var a = window._mlAudioStats;
    if (!a || (!a.started && s.audioBackend === '--')) return;
    s.audioBackend = a.backend;
    s.audioNow={queue:a.depthMs,target:a.targetMs};
    measure(s, 'audioQueue', a.depthMs, 1);
    measure(s, 'audioTarget', a.targetMs, 1);
    ['underruns', 'overruns'].forEach(function(k) {
      if (!number(a[k])) return;
      if (s.audioLast[k] !== undefined && a[k] >= s.audioLast[k]) s.audioDelta[k] += a[k] - s.audioLast[k];
      s.audioLast[k] = a[k];
    });
  }
  function resources(s) {
    // Values are TV-wide, NOT the app's CPU usage, free decoder RAM or temperature.
    try {
      var sys = tizen.systeminfo;
      var free = sys.getAvailableMemory();
      if (number(free) && free > 0) {
        if (s.freeFirst === null) s.freeFirst = free / 1048576;
        s.freeLast = free / 1048576;
        measure(s, 'freeMb', s.freeLast, 1);
      }
      if (!s.cpuPending && typeof sys.getPropertyValue === 'function') {
        s.cpuPending = true;
        sys.getPropertyValue('CPU', function(cpu) {
          if (session !== s) return;
          s.cpuPending = false;
          if (cpu && number(cpu.load)) measure(s, 'cpu', cpu.load * 100, 1);
        }, function() { if (session === s) s.cpuPending = false; });
      }
    } catch (error) { /* capability unavailable: keep --, never invent zero */ }
  }
  function observe(s) {
    var v = s.video;
    if (!v || typeof v.requestVideoFrameCallback !== 'function') return;
    s.presentationSupported = true;
    var callback = function(now, metadata) {
      if (session !== s) return;
      metadata = metadata || {};
      var time = number(metadata.expectedDisplayTime) ? metadata.expectedDisplayTime :
        (number(metadata.presentationTime) ? metadata.presentationTime : now);
      var frames = metadata.presentedFrames;
      var delta = number(frames) && frames > s.lastFrame && s.lastFrame > 0 ? frames - s.lastFrame : 1;
      if (s.lastPresent !== null && time > s.lastPresent) {
        var raw = time - s.lastPresent;
        var interval = raw / delta;
        s.presentationN++;
        s.presentationSum += interval;
        s.presentationMax = Math.max(s.presentationMax, interval);
        s.callbackMax = Math.max(s.callbackMax, raw);
        if (delta > 1) s.coalesced++;
        // Retain long intervals, unlike the unchanged overlay estimator.
        s.presentationBins[Math.min(2047, Math.floor(interval))]++;
        s.presented += delta;
        s.presentedElapsed += raw;
        s.windowPresented += delta;
        s.windowPresentMs += raw;
        s.windowPresentMax = Math.max(s.windowPresentMax, interval);
      }
      s.lastPresent = time;
      if (number(frames)) s.lastFrame = frames;
      try { s.request = v.requestVideoFrameCallback(callback); }
      catch (error) { s.presentationSupported = false; s.request = 0; }
    };
    try { s.request = v.requestVideoFrameCallback(callback); }
    catch (error) { s.presentationSupported = false; }
  }
  function readVariant(s) {
    // Read the actual package metadata, not a TV-model guess.
    try {
      var request = s.configRequest = new XMLHttpRequest();
      request.open('GET', 'config.xml', true);
      request.onload = function() {
        if (session !== s) return;
        s.variant = /use.game.mode"\s+value="true"/.test(request.responseText) ? 'ForceGM' : 'Normal';
        s.configRequest = null;
      };
      request.onerror = function() { if (session === s) s.configRequest = null; };
      request.send();
    } catch (error) { s.configRequest = null; }
  }
  function start(metadata) {
    if (session) finish('New session');
    lifecycle={start:performance.now(),connectedAt:null,metadata:metadata || {}};
    visible=false;lastWindow=null;
  }
  function activate() {
    if (!lifecycle || session || typeof isInGame === 'undefined' || !isInGame) return false;
    var s = session = {
      gen: ++serial, start: performance.now(), connectedAt: null, nativeMs: 0, windows: 0,
      timer: 0, request: 0, video: null, handlers: [], metrics: {}, first: [], last: [],
      received:0, submitted:0, total: 0, lost: 0, rejected: 0, recovered: 0, hostN: 0, hostLate: 0, cadN: 0, cadLate: 0,
      presentationBins: new Uint32Array(2048), presentationN: 0, presentationSum: 0,
      presentationMax: 0, callbackMax: 0, coalesced: 0, presented: 0, lastFrame: 0, lastPresent: null,
      presentedElapsed: 0, windowPresented: 0, windowPresentMs: 0, windowPresentMax: 0, peak: null,
      dropLast: null, dropDelta: 0, dropValid: false, counterResets: 0,
      audioLast: {}, audioDelta: { underruns: 0, overruns: 0 }, audioBackend: '--',
      freeFirst: null, freeLast: null, cpuPending: false, loopMax: 0, stalled: 0, errors: 0,
      warnings: 0, lastError: '', variant: '?', leadInactive: 0, leadSettled: 0,
      config: 'Waiting for stream', note: '', ticks: 0,
      options: 'rumble ' + (checked('rumbleFeedbackSwitch') ? 'on' : 'off') +
        ' · HDR ' + (checked('hdrModeSwitch') ? 'on' : 'off') +
        ' · GM ' + (checked('gameModeSwitch') ? 'on' : 'off')
    };
    if (typeof setAudioTelemetryEnabled === 'function') setAudioTelemetryEnabled('diagnostics', true);
    Module.setDiagnostics(s.gen);
    s.metadata=lifecycle.metadata;
    s.context={version:appInfo.version,build:typeof BUILD_COMMIT!=='undefined' && /^[a-f0-9]{7,40}$/.test(BUILD_COMMIT) ? BUILD_COMMIT : null,tv:modelName,tizen:platformVer,
      pacing:checked('framePacingSwitch'),hdr:checked('hdrModeSwitch'),gameMode:checked('gameModeSwitch'),
      rumble:checked('rumbleFeedbackSwitch'),audio:text('selectAudio'),
      audioLimitMs:parseFloat(text('selectAudioJitter')) || null,
      bitrate:parseFloat(text('selectBitrate')) || null};
    Object.assign(s.context,s.metadata.config || {});
    readVariant(s);
    beginObservation();
    snackbarLogLong('Statistics stay on this TV. Nothing is sent. History: Settings → Diagnosis.');
    return true;
  }
  function connected() {
    if (lifecycle && lifecycle.connectedAt === null) lifecycle.connectedAt=performance.now();
  }
  function beginObservation() {
    var s = session;
    if (!s || s.connectedAt !== null) return;
    s.connectedAt = performance.now();
    s.video = document.getElementById('wasm_module');
    s.dropLast = quality(s.video);
    s.dropValid = s.dropLast !== null;
    readAudio(s);
    resources(s);
    ['waiting', 'stalled', 'error'].forEach(function(type) {
      var fn = function() {
        if (session !== s) return;
        if (type === 'error') s.errors++; else s.stalled++;
      };
      s.video.addEventListener(type, fn);
      s.handlers.push([type, fn]);
    });
    observe(s);
    var expected = performance.now() + 2000;
    var tick = function() {
      if (session !== s) return;
      var now = performance.now();
      s.loopMax = Math.max(s.loopMax, Math.max(0, now - expected));
      readAudio(s);
      var dropped = quality(s.video);
      if (dropped !== null) {
        s.dropValid = true;
        if (s.dropLast !== null) {
          if (dropped >= s.dropLast) s.dropDelta += dropped - s.dropLast;
          else s.counterResets++;
        }
        s.dropLast = dropped;
      }
      if (++s.ticks % 5 === 0) resources(s);
      expected = performance.now() + 2000;
      s.timer = setTimeout(tick, 2000);
    };
    s.timer = setTimeout(tick, 2000);
  }
  function sample(text) {
    var s = session;
    if (!s) return;
    var w;
    try { w = JSON.parse(text); } catch (error) { return; }
    if (!w || w.gen !== s.gen || !number(w.ms) || w.ms <= 0) return;
    if (!['w', 'h', 'fmt', 'fps', 'bytes', 'rx', 'sub', 'total', 'lost', 'rej', 'rec',
      'rtt', 'rttVar', 'hostN', 'hostLate', 'hostMean', 'hostP95', 'enc', 'encMax',
      'asm', 'asmP95', 'asmMax', 'app', 'appP95', 'appMax', 'cadN', 'cadLate',
      'cadP95', 'cadMax', 'leadN', 'lead', 'leadAbsMax', 'filtered', 'target',
      'servo', 'settle', 'clockAge', 'step'].every(function(k) { return number(w[k]); })) return;
    if(!['rx','sub','total','lost','rej','rec','hostN','hostLate','cadN','cadLate','leadN'].every(function(k){return w[k]>=0 && Math.floor(w[k])===w[k];}) || w.bytes<0 || w.lost>w.total)return;
    // A fixed schema, bounded aggregates and only ~30 s of first/last windows.
    s.windows++; s.nativeMs += w.ms;
    lastWindow=w;
    var codec = { 1: 'H264', 256: 'HEVC', 512: 'HEVC10', 4096: 'AV1', 8192: 'AV1-10' }[w.fmt] || ('fmt' + w.fmt);
    s.config = w.w + '×' + w.h + ' ' + codec + ' ' + w.fps + 'fps';
    s.fps = w.fps;
    w.rxFps = w.rx * 1000 / w.ms;
    w.subFps = w.sub * 1000 / w.ms;
    w.hostFps = w.hostN > 0 && w.hostMean > 0 ? 1000 / w.hostMean : null;
    w.bitrate = w.bytes * 8 / w.ms / 1000;
    w.outFps = s.windowPresentMs > 0 ? s.windowPresented * 1000 / s.windowPresentMs : null;
    var peakScore = s.windowPresentMax || w.cadMax;
    if (!s.peak || peakScore > s.peak.score) {
      s.peak = { score: peakScore, at: s.nativeMs / 1000, host: w.hostP95,
        cad: w.cadP95, app: w.appMax, asm:w.asmMax, rtt:w.rtt, lead: w.leadN ? w.lead : null };
    }
    s.windowPresented = s.windowPresentMs = s.windowPresentMax = 0;
    if (!w.leadN) { w.lead = null; w.leadAbsMax = null; }
    if (w.clockAge < 0) w.clockAge = null;
    if (w.rtt < 0) {w.rtt=null;w.rttVar=null;}
    if (w.enc < 0) {w.enc=null;w.encMax=null;}
    if(w.zeroCopy<0)w.zeroCopy=null;
    if (!w.hostN) { w.hostP95 = null; w.hostMean = null; }
    if (!w.cadN) { w.cadP95 = null; w.cadMax = null; }
    ['rxFps', 'subFps', 'hostFps', 'outFps', 'bitrate', 'rtt', 'rttVar', 'hostMean', 'hostP95',
      'enc', 'encMax', 'asm', 'asmP95', 'asmMax', 'app', 'appP95', 'appMax',
      'cadP95', 'cadMax', 'lead', 'leadAbsMax', 'clockAge', 'filtered', 'target', 'step',
      'loadMean', 'loadP95', 'loadMax', 'packetsMean', 'packetsP95', 'packetsMax',
      'zeroCopy', 'hostDeviation', 'cadDeviation'
    ].forEach(function(k) { measure(s, k, w[k], w.ms); });
    s.received+=w.rx;s.submitted+=w.sub;
    s.total += w.total; s.lost += w.lost; s.rejected += w.rej; s.recovered += w.rec;
    s.hostN += w.hostN; s.hostLate += w.hostLate;
    s.cadN += w.cadN; s.cadLate += w.cadLate;
    if (w.leadN && w.settle >= 1800) {
      s.leadSettled++;
      if (!w.servo) s.leadInactive++;
    }
    s.lastServo = w.servo;
    s.lastTarget = w.target;
    if (s.first.length < 15) s.first.push(w);
    s.last.push(w);
    if (s.last.length > 15) s.last.shift();
  }
  function percentile(s) {
    if (!s.presentationN) return null;
    var rank = Math.ceil(s.presentationN * 0.95), count = 0;
    for (var i = 0; i < s.presentationBins.length; i++) {
      count += s.presentationBins[i];
      if (count >= rank) return i === 2047 ? s.presentationMax : Math.min(i + 1,s.presentationMax);
    }
    return null;
  }
  function metrics(s) {
    var m={};
    Object.keys(s.metrics).forEach(function(k) { m[k]=average(s,k);m[k+'Max']=maximum(s,k); });
    m.fpsHost=average(s,'hostFps');
    m.fpsReceived=s.nativeMs>0 ? s.received*1000/s.nativeMs : null;
    m.fpsSubmitted=s.nativeMs>0 ? s.submitted*1000/s.nativeMs : null;
    m.fpsPresented=s.presentedElapsed>0 ? s.presented*1000/s.presentedElapsed : null;
    m.presentP95=percentile(s);m.presentMax=s.presentationN ? s.presentationMax : null;
    m.rtt=average(s,'rtt');m.rttVariation=average(s,'rttVar');
    m.lossPercent=s.total>0 ? s.lost*100/s.total : null;
    m.clientRejects=s.windows ? s.rejected : null;m.browserDrops=s.dropValid ? s.dropDelta : null;
    m.hostProcessing=average(s,'enc');m.hostProcessingMax=maximum(s,'encMax');
    m.assembly=average(s,'asm');m.append=average(s,'app');
    m.audioQueue=average(s,'audioQueue');m.audioTarget=average(s,'audioTarget');
    m.audioUnderruns=s.audioBackend==='--' ? null : s.audioDelta.underruns;
    m.audioOverruns=s.audioBackend==='--' ? null : s.audioDelta.overruns;
    m.recoveries=s.windows ? s.recovered : null;m.waits=s.stalled;m.warnings=s.warnings;m.errors=s.errors;
    m.coalesced=s.coalesced;m.counterResets=s.counterResets;
    m.presentSamples=s.presentationN;
    m.callbackMax=s.presentationN ? s.callbackMax : null;m.jsDelayMax=s.loopMax;
    return m;
  }
  function summaryRows(s,m) {
    var f=fmt;
    return [
      ['Transmission',s.config+' · '+f(s.context.bitrate)+'/'+f(m.bitrate)+' Mbps cfg/rx'],
      ['FPS','PC/Rx/Player/Browser '+[m.fpsHost,m.fpsReceived,m.fpsSubmitted,m.fpsPresented].map(function(v){return f(v);}).join('/')],
      ['Smoothness','Browser interval p95/max (recorded) '+f(m.presentP95)+'/'+f(m.presentMax)+' ms'],
      ['Network','RTT '+f(m.rtt)+' ms · variation '+f(m.rttVariation)+' ms'],
      ['Frames','gaps '+f(m.lossPercent,2)+'% · reject '+f(m.clientRejects,0)+' · browser drop '+f(m.browserDrops,0)],
      ['PC','processing mean/max '+f(m.hostProcessing)+'/'+f(m.hostProcessingMax)+' ms'],
      ['TV work','assembly '+f(m.assembly,2)+' ms · submit '+f(m.append,2)+' ms'],
      ['Audio','buffer/target '+f(m.audioQueue)+'/'+f(m.audioTarget)+' ms · U/O '+f(m.audioUnderruns,0)+'/'+f(m.audioOverruns,0)],
      ['Events','recover '+f(m.recoveries,0)+' · waits '+s.stalled+' · warnings '+s.warnings+' · errors '+s.errors]
    ];
  }
  function detailRows(s) {
    return [
      ['Clock*','lead start→end '+trend(s,'lead')+' ms · |max| '+fmt(maximum(s,'leadAbsMax'))+' · target '+(s.lastServo ? fmt(s.lastTarget) : '--')+' · age max '+fmt(maximum(s,'clockAge'))+' ms · step '+fmt(average(s,'step'),3)],
      ['Host cadence','mean '+fmt(average(s,'hostMean'))+' · worst window p95 '+fmt(maximum(s,'hostP95'))+' ms · late '+fmt(s.hostN ? s.hostLate*100/s.hostN : null)+'%'],
      ['Player cadence','p95 start→end '+trend(s,'cadP95')+' ms · worst p95/max '+fmt(maximum(s,'cadP95'))+'/'+fmt(maximum(s,'cadMax'))+' ms · late '+fmt(s.cadN ? s.cadLate*100/s.cadN : null)+'%'],
      ['Frame load','mean/worst p95/max '+fmt(average(s,'loadMean'))+'/'+fmt(maximum(s,'loadP95'))+'/'+fmt(maximum(s,'loadMax'))+' KiB · packets '+fmt(average(s,'packetsMean'))+'/'+fmt(maximum(s,'packetsP95'))+'/'+fmt(maximum(s,'packetsMax'))],
      ['TV work','assembly worst p95/max '+fmt(maximum(s,'asmP95'),2)+'/'+fmt(maximum(s,'asmMax'),2)+' ms · submit '+fmt(maximum(s,'appP95'),2)+'/'+fmt(maximum(s,'appMax'),2)+' ms · zero-copy '+fmt(average(s,'zeroCopy'))+'%'],
      ['TV / JS','TV CPU mean/max '+fmt(average(s,'cpu'),0)+'/'+fmt(maximum(s,'cpu'),0)+'% · free '+fmt(s.freeFirst,0)+'→'+fmt(s.freeLast,0)+' MB · JS delay max '+fmt(s.loopMax)+' ms'],
      ['Observations','audio '+s.audioBackend+' · coalesced '+s.coalesced+' · counter resets '+s.counterResets+' · callback max '+fmt(s.presentationN ? s.callbackMax : null)+' ms'],
      ['Trend','Browser FPS start→end '+trend(s,'outFps')+' · bitrate '+trend(s,'bitrate')+' Mbps']
    ];
  }
  function makeReport(s,reason) {
    var now=performance.now(),recorded=Math.max(0,now-s.start);
    var duration=Math.max(recorded,now-(lifecycle.connectedAt===null ? lifecycle.start : lifecycle.connectedAt));
    var m=metrics(s),created=Date.now();
    var config=Object.assign({},s.context,{stream:s.config,variant:s.variant});
    return {version:2,id:String(created)+'-'+s.gen,createdAt:created,durationMs:duration,
      recordedMs:recorded,nativeMs:s.nativeMs,game:String(s.metadata.game || '').slice(0,120),
      title:'Diagnosis · '+appInfo.version+' '+s.variant,config:config,metrics:m,
      device:modelName+' · Tizen '+platformVer+(s.context.build ? ' · build '+s.context.build.slice(0,12) : ''),
      rows:summaryRows(s,m),details:detailRows(s),
      finding:String(s.lastError || reason || 'Stopped').slice(0,200),
      peak:s.peak ? 'Peak @'+seconds(s.peak.at*1000)+' · host/cad p95 '+fmt(s.peak.host)+'/'+fmt(s.peak.cad)+' ms · submit max '+fmt(s.peak.app,2)+' ms · lead '+fmt(s.peak.lead)+' ms' : '',
      foot:'Clock ≠ input latency. Browser observations ≠ physical panel measurement. Window p95 ≠ session p95. -- = no data.'};
  }
  function overlayText() {
    if (!session) return tr('Statistics: waiting');
    var m=metrics(session),w=lastWindow;
    // Live native values use the latest window; the saved report uses weighted
    // session aggregates. Percentiles/maxima and counters span the recording.
    if(w){
      m.fpsHost=w.hostFps;m.fpsReceived=w.rxFps;m.fpsSubmitted=w.subFps;m.fpsPresented=w.outFps;
      m.bitrate=w.bitrate;m.rtt=w.rtt;m.rttVariation=w.rttVar;
      m.lossPercent=w.total>0 ? w.lost*100/w.total : null;
      m.hostProcessing=w.enc;m.hostProcessingMax=w.encMax;m.assembly=w.asm;m.append=w.app;
    }
    if(session.audioNow){m.audioQueue=session.audioNow.queue;m.audioTarget=session.audioNow.target;}
    return summaryRows(session,m).map(function(row){return tr(row[0])+': '+tr(row[1]);}).join('\n');
  }
  function finish(reason) {
    var s = session;
    if (!s) { lifecycle=null;visible=false;lastWindow=null;return; }
    readAudio(s);
    if (s.video) {
      var dropped = quality(s.video);
      if (dropped !== null && s.dropLast !== null && dropped >= s.dropLast) s.dropDelta += dropped - s.dropLast;
    }
    if (typeof setAudioTelemetryEnabled === 'function') setAudioTelemetryEnabled('diagnostics', false);
    session = null; // Invalidate callbacks before cancelling or saving.
    Module.setDiagnostics(0);
    clearTimeout(s.timer);
    if (s.configRequest) s.configRequest.abort();
    if (s.video) {
      if (s.request && typeof s.video.cancelVideoFrameCallback === 'function') {
        try { s.video.cancelVideoFrameCallback(s.request); } catch (error) {}
      }
      s.handlers.forEach(function(h) { s.video.removeEventListener(h[0], h[1]); });
    }
    report = makeReport(s, reason || 'Stopped');
    var saved=store().save(report);
    lifecycle=null;visible=false;lastWindow=null;
    snackbarLogLong(saved.ok ? 'Saved on this TV. Settings → Diagnosis → History.' : 'Could not save diagnosis. Previous history was preserved.');
  }
  function show() { if (typeof DiagnosticView !== 'undefined') DiagnosticView.latest(); }
  return {
    start:start,connected:connected,configure:function(meta){if(lifecycle)lifecycle.metadata=meta;},activate:activate,sample:sample,finish:finish,show:show,
    isRecording:function(){return session!==null;},isVisible:function(){return visible;},
    setVisible:function(value) { visible=!!value;if(visible)activate(); },overlayText:overlayText,
    current:function(){return session ? metrics(session) : null;},
    changed:function(){},
    note:function(text,error) {
      if(!session)return;
      if(error)session.errors++;else session.warnings++;
      session.lastError=String(text).slice(0,90);
    }
  };
})();

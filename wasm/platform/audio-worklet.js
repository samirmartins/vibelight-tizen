/* global AudioWorkletProcessor, registerProcessor, sampleRate */

// Indexes into AudioRingControl in wasm/audio_ring.hpp.
var ML_AUD_READ = 0;
var ML_AUD_WRITE = 1;
var ML_AUD_GENERATION = 2;
var ML_AUD_MODE = 3;
var ML_AUD_UNDERRUNS = 4;
var ML_AUD_OVERRUNS = 5;
var ML_AUD_TARGET = 6;
var ML_AUD_MIN_DEPTH = 7;
var ML_AUD_MAX_DEPTH = 8;
var ML_AUD_CONSUMED = 9;
var ML_AUD_DRIFT_PPM = 10;
var ML_AUD_STARTED = 11;
var ML_AUD_EPOCH = 12;
var ML_AUD_INITIAL_TARGET = 13;
var ML_AUD_MAX_TARGET = 14;
var ML_AUD_RESET_AT = 15;
var ML_AUD_RESET_ACK = 16;
var ML_AUD_GATE = 17;

var ML_DECAY_BASE_S = 10;
var ML_DECAY_MAX_S = 60;
// Lead over the target that stays for a whole second is dropped down to this much above it.
var ML_LEAD_NONE = 0x7fffffff;
var ML_LEAD_LIMIT_S = 0.04;
var ML_LEAD_KEEP_S = 0.01;

function mlClamp(value, minimum, maximum) {
  return value < minimum ? minimum : (value > maximum ? maximum : value);
}

class MoonlightPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.control = null;
    this.pcm = null;
    this.capacity = 0;
    this.mask = 0;
    this.channels = 0;
    this.sourceRate = 48000;
    this.generation = 0;
    this.readFrame = 0;
    this.phase = 0.0;
    this.epoch = 0;
    this.started = false;
    this.stableOutputFrames = 0;
    // Seconds of stable playback before the raised target steps down; stretched by underruns.
    this.decayWaitS = ML_DECAY_BASE_S;
    this.leadMin = ML_LEAD_NONE;
    this.leadFrames = 0;
    this.statsCountdown = 0;
    this.noteDepth = this.ignoreDepth;

    this.port.onmessage = (event) => {
      var data = event.data || {};
      if (data.type === 'stop') {
        this.ready = false;
        this.started = false;
        return;
      }
      // Collection changes arrive only on explicit consumer transitions.
      if (data.type === 'telemetry') {
        if (this.ready && data.generation === this.generation) this.setTelemetry(data.enabled);
        return;
      }
      if (data.type !== 'init' || !data.memory) {
        return;
      }

      try {
        this.control = new Int32Array(data.memory, data.controlPtr, 18);
        this.pcm = new Int16Array(
          data.memory, data.pcmPtr, data.capacityFrames * data.channels);
        this.capacity = data.capacityFrames >>> 0;
        this.mask = this.capacity - 1;
        this.channels = data.channels >>> 0;
        this.sourceRate = data.sourceRate >>> 0;
        this.generation = data.generation >>> 0;
        this.readFrame = Atomics.load(this.control, ML_AUD_READ) >>> 0;
        this.epoch = Atomics.load(this.control, ML_AUD_RESET_ACK) >>> 0;
        this.phase = 0.0;
        this.started = false;
        this.stableOutputFrames = 0;
        this.decayWaitS = ML_DECAY_BASE_S;
        this.leadMin = ML_LEAD_NONE;
        this.leadFrames = 0;
        this.setTelemetry(data.telemetry);
        this.ready = true;
      } catch (e) {
        this.ready = false;
        this.port.postMessage({ type: 'error', message: String(e) });
      }
    };
  }

  // Optional depth collection changes no PCM/servo/adaptation code.
  ignoreDepth() {}
  setTelemetry(enabled) {
    this.noteDepth = enabled === true ? MoonlightPcmProcessor.prototype.noteDepth : this.ignoreDepth;
  }
  // End optional depth collection switch.

  clear(outputs, from) {
    for (var channel = 0; channel < outputs.length; channel++) {
      outputs[channel].fill(0, from || 0);
    }
  }

  noteDepth(depth) {
    if (--this.statsCountdown > 0) {
      return;
    }
    this.statsCountdown = 16;

    var oldMin = Atomics.load(this.control, ML_AUD_MIN_DEPTH) >>> 0;
    while (depth < oldMin) {
      var observedMin = Atomics.compareExchange(
        this.control, ML_AUD_MIN_DEPTH, oldMin | 0, depth | 0) >>> 0;
      if (observedMin === oldMin) { break; }
      oldMin = observedMin;
    }

    var oldMax = Atomics.load(this.control, ML_AUD_MAX_DEPTH) >>> 0;
    while (depth > oldMax) {
      var observedMax = Atomics.compareExchange(
        this.control, ML_AUD_MAX_DEPTH, oldMax | 0, depth | 0) >>> 0;
      if (observedMax === oldMax) { break; }
      oldMax = observedMax;
    }
  }

  handleUnderrun(outputs, from) {
    this.clear(outputs, from);
    if (this.started) {
      Atomics.add(this.control, ML_AUD_UNDERRUNS, 1);
      var target = Atomics.load(this.control, ML_AUD_TARGET) >>> 0;
      var maximum = Atomics.load(this.control, ML_AUD_MAX_TARGET) >>> 0;
      var step = Math.max(1, Math.round(this.sourceRate * 0.005));
      Atomics.store(this.control, ML_AUD_TARGET,
        Math.min(maximum, target + step) | 0);
      this.decayWaitS = Math.min(ML_DECAY_MAX_S, this.decayWaitS * 2);
    }
    this.started = false;
    this.stableOutputFrames = 0;
    this.leadMin = ML_LEAD_NONE;
    this.leadFrames = 0;
    Atomics.store(this.control, ML_AUD_STARTED, 0);
  }

  process(inputs, outputList) {
    var control = this.control, outputs = outputList[0];
    if (!this.ready || !control || Atomics.compareExchange(control, ML_AUD_GATE, 0, 1) !== 0) {
      if (outputs) this.clear(outputs, 0);
      return true;
    }
    try { return this.render(inputs, outputList); }
    finally { Atomics.and(control, ML_AUD_GATE, ~3); }
  }

  render(inputs, outputList) {
    var outputs = outputList[0];
    if (!outputs || outputs.length === 0) {
      return true;
    }

    if (!this.ready || !this.control ||
        (Atomics.load(this.control, ML_AUD_MODE) | 0) !== 1 ||
        (Atomics.load(this.control, ML_AUD_GENERATION) >>> 0) !== this.generation) {
      this.clear(outputs, 0);
      return true;
    }

    var currentEpoch = Atomics.load(this.control, ML_AUD_EPOCH) >>> 0;
    if (currentEpoch !== (Atomics.load(this.control, ML_AUD_RESET_ACK) >>> 0)) {
      this.epoch = currentEpoch;
      this.readFrame = Atomics.load(this.control, ML_AUD_RESET_AT) >>> 0;
      this.phase = 0.0;
      this.started = false;
      this.stableOutputFrames = 0;
      Atomics.store(this.control, ML_AUD_STARTED, 0);
      Atomics.store(this.control, ML_AUD_READ, this.readFrame | 0);
      this.clear(outputs, 0);
      Atomics.store(this.control, ML_AUD_RESET_ACK, currentEpoch | 0);
      return true;
    }

    var writeFrame = Atomics.load(this.control, ML_AUD_WRITE) >>> 0;
    var depth = (writeFrame - this.readFrame) >>> 0;
    var target = Atomics.load(this.control, ML_AUD_TARGET) >>> 0;
    this.noteDepth(depth);

    if (!this.started) {
      if (depth < target + 2) {
        this.clear(outputs, 0);
        return true;
      }
      // PCM that piled up before the output began (backend still loading) would play as a fixed
      // delay; start from the newest target frames instead. Skipped frames are not counted as played.
      if (depth > target + Math.round(this.sourceRate * 0.02)) {
        this.readFrame = (writeFrame - target) >>> 0;
        this.phase = 0.0;
        Atomics.store(this.control, ML_AUD_READ, this.readFrame | 0);
        depth = target;
      }
      this.started = true;
      Atomics.store(this.control, ML_AUD_STARTED, 1);
    }

    var outputFrames = outputs[0].length;
    // Audio that never came close to the target for a whole second is delay nobody needs:
    // drop it, keeping a little above the target. Dropped frames are not counted as played.
    var lead = depth - target;
    if (lead < this.leadMin) this.leadMin = lead;
    this.leadFrames += outputFrames;
    if (this.leadFrames >= sampleRate) {
      var leadFloor = this.leadMin;
      this.leadMin = ML_LEAD_NONE;
      this.leadFrames = 0;
      if (leadFloor > Math.round(this.sourceRate * ML_LEAD_LIMIT_S)) {
        var drop = leadFloor - Math.round(this.sourceRate * ML_LEAD_KEEP_S);
        this.readFrame = (this.readFrame + drop) >>> 0;
        Atomics.store(this.control, ML_AUD_READ, this.readFrame | 0);
        depth -= drop;
      }
    }
    var driftPpm = Atomics.load(this.control, ML_AUD_DRIFT_PPM) | 0;
    var error = target > 0 ? (depth - target) / target : 0;
    var bufferPpm = mlClamp(Math.round(error * 10000), -3000, 7500);
    var totalPpm = mlClamp(bufferPpm + driftPpm, -5000, 10000);
    var stepRatio = (this.sourceRate / sampleRate) * (1 + totalPpm / 1000000);
    var consumedThisQuantum = 0;

    for (var frame = 0; frame < outputFrames; frame++) {
      var available = (writeFrame - this.readFrame) >>> 0;
      if (available < 2) {
        Atomics.store(this.control, ML_AUD_READ, this.readFrame | 0);
        Atomics.add(this.control, ML_AUD_CONSUMED, consumedThisQuantum | 0);
        this.handleUnderrun(outputs, frame);
        return true;
      }

      var first = this.readFrame & this.mask;
      var second = (this.readFrame + 1) & this.mask;
      var fraction = this.phase;
      var copyChannels = Math.min(outputs.length, this.channels);
      for (var channel = 0; channel < copyChannels; channel++) {
        var a = this.pcm[first * this.channels + channel];
        var b = this.pcm[second * this.channels + channel];
        outputs[channel][frame] = (a + (b - a) * fraction) / 32768.0;
      }
      for (var extra = copyChannels; extra < outputs.length; extra++) {
        outputs[extra][frame] = 0;
      }

      this.phase += stepRatio;
      var advance = Math.floor(this.phase);
      if (advance > 0) {
        this.phase -= advance;
        this.readFrame = (this.readFrame + advance) >>> 0;
        consumedThisQuantum += advance;
      }
    }

    Atomics.store(this.control, ML_AUD_READ, this.readFrame | 0);
    Atomics.add(this.control, ML_AUD_CONSUMED, consumedThisQuantum | 0);
    this.stableOutputFrames += outputFrames;

    // An underrun temporarily raises the target. After a stable stretch (10 s, doubled by
    // each underrun up to a minute, halved by each step), walk it back towards the
    // low-latency initial target in small 2.5 ms steps.
    if (this.stableOutputFrames >= sampleRate * this.decayWaitS) {
      this.stableOutputFrames = 0;
      var currentTarget = Atomics.load(this.control, ML_AUD_TARGET) >>> 0;
      var initialTarget = Atomics.load(this.control, ML_AUD_INITIAL_TARGET) >>> 0;
      if (currentTarget > initialTarget) {
        var reduce = Math.max(1, Math.round(this.sourceRate * 0.0025));
        Atomics.store(this.control, ML_AUD_TARGET,
          Math.max(initialTarget, currentTarget - reduce) | 0);
        this.decayWaitS = Math.max(ML_DECAY_BASE_S, this.decayWaitS / 2);
      } else {
        this.decayWaitS = ML_DECAY_BASE_S;
      }
    }

    return true;
  }
}

registerProcessor('moonlight-pcm', MoonlightPcmProcessor);

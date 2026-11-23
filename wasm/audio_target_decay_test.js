'use strict';
// After an underrun raises the audio target, it comes back to the low-latency level in seconds,
// not half an hour; the wait grows (up to the old minute) only when underruns keep coming.
// Both consumers, driven by real quanta of 128 frames (8 kHz keeps the run short; the rules are in seconds and in milliseconds of target).
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const CAPACITY = 16384, CHANNELS = 2, RATE = 8000, INITIAL = 80, CEILING = 800, QUANTUM = 128; // a low rate keeps the simulated minutes cheap

function fixture(mode) {
  let Processor;
  const memory = new SharedArrayBuffer(128 + CAPACITY * CHANNELS * 2);
  const control = new Int32Array(memory, 0, 18), pcm = new Int16Array(memory, 128, CAPACITY * CHANNELS);
  pcm.fill(12000);
  control[2] = 7; control[3] = mode; control[6] = control[13] = INITIAL; control[14] = CEILING;
  const c = {AudioWorkletProcessor: class { constructor() { this.port = {postMessage() {}}; } }, registerProcessor: (n, p) => Processor = p,
    sampleRate: RATE, Atomics, window: {}, console, performance: {now: () => 0}, setTimeout, clearTimeout};
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/audio-worklet.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync('wasm/platform/audio.js', 'utf8'), c);
  c._audControl = control; c._audPcm = pcm; c._audGeneration = 7; c._audCapacityFrames = CAPACITY; c._audChannels = CHANNELS; c._audSourceRate = RATE;
  const p = new Processor();
  p.port.onmessage({data: {type: 'init', memory, controlPtr: 0, pcmPtr: 128, capacityFrames: CAPACITY, channels: CHANNELS, sourceRate: RATE, generation: 7}});
  let quanta = 0;
  const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  // One quantum with a healthy buffer (a little above the target), or a starved one.
  function step(starve) {
    // Healthy: the buffer holds the target plus a little (inside the 20 ms start slack).
    control[1] = starve ? control[0] : (control[0] + control[6] + 100) | 0;
    if (mode === 1) p.process([], [out]);
    else c._audProcessFallback({outputBuffer: {length: QUANTUM, sampleRate: RATE, numberOfChannels: CHANNELS, getChannelData: i => out[i]}});
    quanta++;
  }
  const seconds = () => quanta * QUANTUM / RATE;
  // Healthy playback until `until()` or the time limit; returns the seconds it took.
  function play(limitS, until) {
    const t0 = seconds();
    while (seconds() - t0 < limitS && !until()) step(false);
    return seconds() - t0;
  }
  function underrun() { step(true); step(false); } // starve, then recover
  step(false); step(false); // start
  assert.strictEqual(control[11], 1, 'started');
  return {control, step, play, underrun, seconds};
}

for (const mode of [1, 2]) {
  const tag = 'mode ' + mode + ': ';
  // One underrun: +5 ms. The first step down waits 20 s, the next only 10 s; never below the start.
  let f = fixture(mode);
  f.underrun();
  const raised = f.control[6];
  assert.strictEqual(raised, INITIAL + 40, tag + 'target raised by 5 ms');
  let took = f.play(60, () => f.control[6] < raised);
  assert(took >= 19 && took <= 21, tag + 'first step after about 20 s, took ' + took);
  const second = f.control[6];
  took = f.play(60, () => f.control[6] < second);
  assert(took >= 9 && took <= 11, tag + 'next step after about 10 s, took ' + took);
  assert.strictEqual(f.control[6], INITIAL, tag + 'back at the low-latency level');
  f.play(30, () => false);
  assert.strictEqual(f.control[6], INITIAL, tag + 'never below the initial target');

  // A high target (a burst of underruns) also comes back in a few minutes, not half an hour.
  f = fixture(mode);
  for (let i = 0; i < 6; i++) { f.underrun(); f.play(2, () => false); } // 6 underruns, 2 s apart
  const high = f.control[6];
  assert(high > INITIAL + 150,  tag + 'raised well above the start: ' + high);
  const start = f.seconds();
  f.play(300, () => f.control[6] === INITIAL);
  assert.strictEqual(f.control[6], INITIAL, tag + 'back to the start within five minutes');
  assert(f.seconds() - start < 300);

  // Underruns that keep coming stretch the wait: after an underrun at once, no step for ~40 s.
  f = fixture(mode);
  f.underrun(); f.underrun();
  const twice = f.control[6];
  took = f.play(120, () => f.control[6] < twice);
  assert(took >= 39 && took <= 41, tag + 'wait doubled again, took ' + took);

  // ...but never past the old minute, however many underruns.
  f = fixture(mode);
  for (let i = 0; i < 8; i++) f.underrun();
  const stuck = f.control[6];
  took = f.play(120, () => f.control[6] < stuck);
  assert(took >= 59 && took <= 61, tag + 'wait capped at 60 s, took ' + took);

  // Not stable, no step: an underrun every 5 s keeps the target where it is.
  f = fixture(mode);
  f.underrun();
  const held = f.control[6];
  for (let i = 0; i < 6; i++) { f.play(5, () => false); assert(f.control[6] >= held, tag + 'no decay while underruns keep coming'); f.underrun(); }
}
console.log('audio_target_decay_test: OK');

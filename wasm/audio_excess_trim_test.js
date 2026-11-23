'use strict';
// Audio that stays far ahead of the target for a full second is delay nobody needs: the excess is
// dropped, keeping 10 ms above the target. A short burst or a modest lead is left alone. Both
// consumers. Dropped frames are not counted as played.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const CAPACITY = 16384, CHANNELS = 2, RATE = 48000, TARGET = 480, QUANTUM = 128;

function fixture(mode) {
  let Processor;
  const memory = new SharedArrayBuffer(128 + CAPACITY * CHANNELS * 2);
  const control = new Int32Array(memory, 0, 18), pcm = new Int16Array(memory, 128, CAPACITY * CHANNELS);
  pcm.fill(12000);
  control[2] = 7; control[3] = mode; control[6] = control[13] = TARGET; control[14] = 4800;
  const c = {AudioWorkletProcessor: class { constructor() { this.port = {postMessage() {}}; } }, registerProcessor: (n, p) => Processor = p,
    sampleRate: RATE, Atomics, window: {}, console, performance: {now: () => 0}, setTimeout, clearTimeout};
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/audio-worklet.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync('wasm/platform/audio.js', 'utf8'), c);
  c._audControl = control; c._audPcm = pcm; c._audGeneration = 7; c._audCapacityFrames = CAPACITY; c._audChannels = CHANNELS; c._audSourceRate = RATE;
  const p = new Processor();
  p.port.onmessage({data: {type: 'init', memory, controlPtr: 0, pcmPtr: 128, capacityFrames: CAPACITY, channels: CHANNELS, sourceRate: RATE, generation: 7}});
  const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  let quanta = 0;
  // One quantum whose buffer starts `above` frames over the target.
  function step(above) {
    control[1] = (control[0] + control[6] + above) | 0;
    if (mode === 1) p.process([], [out]);
    else c._audProcessFallback({outputBuffer: {length: QUANTUM, sampleRate: RATE, numberOfChannels: CHANNELS, getChannelData: i => out[i]}});
    quanta++;
  }
  const seconds = () => quanta * QUANTUM / RATE;
  const dropped = () => ((control[0] - control[9]) | 0); // read position beyond what was played
  function run(s, above) { const end = seconds() + s; while (seconds() < end) step(above); }
  step(100); step(100);
  assert.strictEqual(control[11], 1, 'started');
  assert.strictEqual(dropped(), 0, 'nothing dropped at a normal start');
  return {control, step, run, seconds, dropped};
}

for (const mode of [1, 2]) {
  const tag = 'mode ' + mode + ': ';
  // 62 ms over the target (more than 40 ms) for good: nothing is dropped during the first second
  // (that window also holds the normal start), then the excess goes, leaving 10 ms above the target.
  let f = fixture(mode);
  f.run(0.9, 3000);
  assert.strictEqual(f.dropped(), 0, tag + 'nothing dropped before a full second');
  f.run(1.4, 3000);
  const drop = f.dropped();
  assert(drop >= 3000 - 480 - 300 && drop <= 3000 - 480 + 300, tag + 'dropped about 2500 frames, got ' + drop);
  assert.strictEqual(f.control[4], 0, tag + 'no underrun caused');

  // The buffer after the drop still holds the target plus margin.
  f = fixture(mode);
  f.run(2.1, 3000);
  f.step(100); // a normal quantum right after: still plays, no underrun
  assert.strictEqual(f.control[4], 0);

  // A burst shorter than a second never trims, even a big one.
  f = fixture(mode);
  f.run(0.8, 6000); f.run(0.5, 100); f.run(0.8, 6000); f.run(0.5, 100);
  assert.strictEqual(f.dropped(), 0, tag + 'bursts are left alone');

  // A modest lead (31 ms) is not worth dropping, however long it lasts.
  f = fixture(mode);
  f.run(3, 1500 - 0);
  assert.strictEqual(f.dropped(), 0, tag + 'a lead under 40 ms stays');

  // An underrun restarts the count: a second of excess after it still trims only after a full second.
  f = fixture(mode);
  f.run(0.8, 3000);
  f.step(-480); f.step(-480); // starve (depth 0)
  f.step(100); f.step(100);
  f.run(0.6, 3000);
  assert.strictEqual(f.dropped(), 0, tag + 'the window starts again after an underrun');
}
console.log('audio_excess_trim_test: OK');

'use strict';
// Audio that waited for its backend must not start behind: PCM that piled up before the output
// began is dropped down to the target, in both consumers (worklet and ScriptProcessor fallback).
// The skipped frames are not counted as played, so the A/V servo sees no jump.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const CAPACITY = 16384, CHANNELS = 2, RATE = 48000, TARGET = 480; // 10 ms

function fixture(mode, write) {
  let Processor;
  const memory = new SharedArrayBuffer(128 + CAPACITY * CHANNELS * 2);
  const control = new Int32Array(memory, 0, 18), pcm = new Int16Array(memory, 128, CAPACITY * CHANNELS);
  pcm.fill(12000);
  control[1] = write; control[2] = 7; control[3] = mode; control[6] = control[13] = TARGET; control[14] = 4800;
  const c = {AudioWorkletProcessor: class { constructor() { this.port = {postMessage() {}}; } }, registerProcessor: (n, p) => Processor = p,
    sampleRate: RATE, Atomics, window: {}, console, performance: {now: () => 0}, setTimeout, clearTimeout};
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('wasm/platform/audio-worklet.js', 'utf8'), c);
  vm.runInContext(fs.readFileSync('wasm/platform/audio.js', 'utf8'), c);
  c._audControl = control; c._audPcm = pcm; c._audGeneration = 7; c._audCapacityFrames = CAPACITY; c._audChannels = CHANNELS; c._audSourceRate = RATE;
  const p = new Processor();
  p.port.onmessage({data: {type: 'init', memory, controlPtr: 0, pcmPtr: 128, capacityFrames: CAPACITY, channels: CHANNELS, sourceRate: RATE, generation: 7}});
  function run() {
    const out = [new Float32Array(128), new Float32Array(128)];
    if (mode === 1) p.process([], [out]);
    else c._audProcessFallback({outputBuffer: {length: 128, sampleRate: RATE, numberOfChannels: CHANNELS, getChannelData: i => out[i]}});
    return out;
  }
  const depth = () => ((control[1] - control[0]) >>> 0);
  return {control, run, depth, p, c};
}

for (const mode of [1, 2]) {
  // 300 ms piled up before the backend started: playback starts at the target, not 300 ms behind.
  let f = fixture(mode, 14400);
  let out = f.run();
  assert(out[0][0] > 0.3 && out[0][0] < 0.4, 'mode ' + mode + ': plays the audio');
  assert.strictEqual(f.control[11], 1, 'started');
  assert(f.depth() >= TARGET - 256 && f.depth() <= TARGET + 64, 'mode ' + mode + ': depth ' + f.depth() + ' is about the target');
  assert((f.control[9] >>> 0) <= 256, 'skipped frames are not counted as played: ' + f.control[9]);

  // A backlog within 20 ms of the target is left alone (normal start).
  f = fixture(mode, TARGET + 800);
  f.run();
  assert(f.control[0] >= 120 && f.control[0] <= 136, 'mode ' + mode + ': nothing skipped, read ' + f.control[0]);
  assert.strictEqual(f.control[9] >>> 0, f.control[0] >>> 0);

  // Not enough audio yet: still waits, nothing skipped.
  f = fixture(mode, 100);
  out = f.run();
  assert(out[0].every(v => v === 0)); assert.strictEqual(f.control[11], 0); assert.strictEqual(f.control[0], 0);

  // A big backlog with a larger target keeps that target (skips down to it, not below).
  f = fixture(mode, 14400); f.control[6] = 2400;
  f.run();
  assert(f.depth() >= 2400 - 256 && f.depth() <= 2400 + 64, 'mode ' + mode + ': follows the current target, depth ' + f.depth());
}
console.log('audio_backlog_test: OK');

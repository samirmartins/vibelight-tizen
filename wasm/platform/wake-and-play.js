// Wake and play. When the PC is known to be off and has a MAC to wake, Play can offer to send
// Wake-on-LAN and start the game once the PC answers. Only this decision lives here; it runs
// before a stream starts and never during one. Pure rules: no DOM, no timers.
var WakeAndPlay = (function() {
  'use strict';
  var KEY = 'vibelight.wake-play.policy';
  var POLICIES = ['ask', 'wake', 'never'];
  var DEFAULT = 'ask';

  function valid(value) { return POLICIES.indexOf(value) !== -1; }

  // ask: offer the choice; wake: wake the PC and play without asking; never: play as before.
  function policy(storage) {
    try {
      var value = storage && storage.getItem(KEY);
      return valid(value) ? value : DEFAULT;
    } catch (e) { return DEFAULT; }
  }
  function setPolicy(storage, value) {
    if (!valid(value)) return false;
    try { storage.setItem(KEY, value); return true; } catch (e) { return false; }
  }
  function nextPolicy(current) {
    var at = POLICIES.indexOf(valid(current) ? current : DEFAULT);
    return POLICIES[(at + 1) % POLICIES.length];
  }

  // options: {policy, state: 'offline' | 'online' | 'unknown', mac}. Only a finished check that
  // found the PC unreachable, with a MAC to wake, changes what Play does.
  function decide(options) {
    if (!options || options.state !== 'offline' || !options.mac) return 'play';
    var chosen = valid(options.policy) ? options.policy : DEFAULT;
    return chosen === 'never' ? 'play' : chosen;
  }

  // The policy saved by "remember" for an answer, or null when nothing is saved.
  function remembered(answer, remember) {
    if (!remember) return null;
    if (answer === 'wake') return 'wake';
    if (answer === 'try') return 'never';
    return null;
  }

  // The settings button: one press moves to the next choice, saves it and shows it.
  var LABELS = { ask: 'Ask', wake: 'Wake and play', never: 'Just try to play' };
  function choiceLabel(value) { return LABELS[valid(value) ? value : DEFAULT]; }
  function show(button, storage) {
    if (button) button.textContent = choiceLabel(policy(storage));
  }
  function cycle(button, storage) {
    setPolicy(storage, nextPolicy(policy(storage)));
    show(button, storage);
  }
  function reset(button, storage) {
    setPolicy(storage, DEFAULT);
    if (button) button.textContent = choiceLabel(DEFAULT);
  }

  // The wait after Play: one wake packet, then a check every INTERVAL_MS until the PC answers or
  // LIMIT_MS pass. options: {send(), probe(), setTimeout, clearTimeout, now, intervalMs, limitMs,
  // onProgress(elapsedMs)}; send and probe return promises (probe resolves true once the PC is
  // ready to stream). Returns {promise, cancel}; the promise resolves once with
  // {result: 'ready' | 'timeout' | 'cancelled' | 'send-failed', elapsedMs}. The checks never
  // overlap, a late answer after the end is ignored, and no timer survives the end.
  var INTERVAL_MS = 4000, LIMIT_MS = 120000;
  function wait(options) {
    var set = options.setTimeout, clear = options.clearTimeout, now = options.now;
    var interval = options.intervalMs > 0 ? options.intervalMs : INTERVAL_MS;
    var limit = options.limitMs > 0 ? options.limitMs : LIMIT_MS;
    var started = now(), done = false, timer = 0, deadline = 0, resolveOutcome;
    var promise = new Promise(function(resolve) { resolveOutcome = resolve; });

    function progress() {
      if (typeof options.onProgress !== 'function') return;
      try { options.onProgress(now() - started); } catch (e) { /* the display must not stop the wait */ }
    }
    function finish(result) {
      if (done) return;
      done = true;
      clear(timer); clear(deadline);
      resolveOutcome({ result: result, elapsedMs: now() - started });
    }
    function schedule() {
      if (!done) timer = set(tick, interval);
    }
    function tick() {
      if (done) return;
      progress();
      var check;
      try { check = Promise.resolve(options.probe()); } catch (e) { check = Promise.reject(e); }
      check.then(function(ready) {
        if (done) return;
        if (ready === true) finish('ready'); else schedule();
      }, function() { schedule(); });
    }

    progress();
    deadline = set(function() { finish('timeout'); }, limit);
    var sent;
    try { sent = Promise.resolve(options.send()); } catch (e) { sent = Promise.reject(e); }
    sent.then(schedule, function() { finish('send-failed'); });
    return { promise: promise, cancel: function() { finish('cancelled'); } };
  }

  return { INTERVAL_MS: INTERVAL_MS, LIMIT_MS: LIMIT_MS, wait: wait, KEY: KEY, POLICIES: POLICIES, DEFAULT: DEFAULT, policy: policy, setPolicy: setPolicy,
    nextPolicy: nextPolicy, choiceLabel: choiceLabel, show: show, cycle: cycle, reset: reset, decide: decide, remembered: remembered };
})();

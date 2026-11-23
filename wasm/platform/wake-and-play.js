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

  return { KEY: KEY, POLICIES: POLICIES, DEFAULT: DEFAULT, policy: policy, setPolicy: setPolicy,
    nextPolicy: nextPolicy, decide: decide, remembered: remembered };
})();

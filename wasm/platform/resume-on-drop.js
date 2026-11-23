// Resume after a connection drop. When a stream ends because the network or the video failed, and the
// setting is on (it is by default), the library resumes the same game once. This module holds only the
// rules: which endings qualify, the saved setting and the limit of automatic resumes in a row. It runs
// after a stream has ended, never during one. No DOM, no timers.
var ResumeOnDrop = (function() {
  'use strict';
  var KEY = 'vibelight.resume-on-drop';
  var MAX_IN_A_ROW = 3, STABLE_MS = 120000;
  // Host errors where resuming cannot help: failure to start, protected content, encoding error.
  var HOST_ERRORS = [-102, -103, -104];
  var last = null, inARow = 0;

  // On unless the user turned it off; a blocked storage keeps the default.
  function enabled(storage) {
    try { return !(storage && storage.getItem(KEY) === '0'); } catch (e) { return true; }
  }
  function setEnabled(storage, on) {
    try { storage.setItem(KEY, on ? '1' : '0'); return true; } catch (e) { return false; }
  }

  // Network and video drops qualify. A graceful end (0), a host error or a non-code does not.
  function eligible(code) {
    return typeof code === 'number' && isFinite(code) && code !== 0 && HOST_ERRORS.indexOf(code) === -1;
  }

  // Called when a game starts. A manual start begins the count again; an automatic resume does not.
  function noteLaunch(host, appId, now, automatic) {
    last = { host: host, appId: appId, at: now };
    if (automatic !== true) inARow = 0;
  }

  // Called when a stream ends: {code, now, enabled}. Returns {resume: false} or {resume: true, host, appId}.
  // The noted game is used up either way, so one launch gives at most one resume.
  function onTermination(options) {
    var launch = last;
    last = null;
    if (!launch || !options || options.enabled !== true || !eligible(options.code)) return { resume: false };
    if (options.now - launch.at >= STABLE_MS) inARow = 0;
    if (inARow >= MAX_IN_A_ROW) return { resume: false };
    inARow++;
    return { resume: true, host: launch.host, appId: launch.appId };
  }

  return { KEY: KEY, enabled: enabled, setEnabled: setEnabled, eligible: eligible, noteLaunch: noteLaunch,
    onTermination: onTermination, MAX_IN_A_ROW: MAX_IN_A_ROW, STABLE_MS: STABLE_MS };
})();

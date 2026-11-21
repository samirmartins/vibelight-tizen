// Suggestions from the local session summaries already stored on this TV. Fixed
// rules and thresholds; nothing is collected, sent or changed automatically, and
// this code runs only when a saved diagnosis is opened in Settings, never during
// a stream. Wording says what often helps and what it costs, never a certain cause.
var DiagnosticHints = (function() {
  'use strict';
  var T = Object.freeze({minRecordedMs: 120000, lossPercent: 0.5, rttVariation: 10, audioPerMinute: 2,
    framesPerMinute: 5, hostFrame: 0.6});
  function finite(n) { return typeof n === 'number' && isFinite(n); }
  function usable(record) {
    return !!record && typeof record === 'object' && record.version === 2 && !record.legacy &&
      !!record.metrics && typeof record.metrics === 'object' && finite(record.recordedMs) &&
      record.recordedMs >= T.minRecordedMs;
  }
  function one(n) { return String(Math.round(n * 10) / 10); }
  function metric(record, key) { return DiagnosticHistory.metric(record, key); }
  // Sum of the available parts, or null when none is available.
  function total(record, keys) {
    var sum = null;
    keys.forEach(function(key) { var n = metric(record, key); if (finite(n)) sum = (sum || 0) + n; });
    return sum;
  }
  function hint(id, text) { return {id: id, text: text}; }

  function forRecord(record) {
    if (!usable(record)) return {status: 'none', hints: []};
    var hints = [], judged = false;
    var loss = metric(record, 'lossPercent'), jitter = metric(record, 'rttVariation');
    var audio = total(record, ['audioUnderruns', 'audioOverruns']);
    var frames = total(record, ['clientRejects', 'browserDrops']);
    var host = metric(record, 'hostProcessing'), fps = metric(record, 'fpsHost');
    if (finite(loss)) {
      judged = true;
      if (loss >= T.lossPercent) hints.push(hint('loss', 'Frame gaps reached ' + one(loss) + '%. This often points to network loss. ' +
        'A wired connection or 5 GHz Wi-Fi may help; a lower bitrate can reduce gaps at the cost of image detail.'));
    }
    if (finite(jitter)) {
      judged = true;
      if (jitter >= T.rttVariation) hints.push(hint('jitter', 'Network latency varied by ' + one(jitter) + ' ms. ' +
        'Congested Wi-Fi is a common cause; a wired connection usually steadies it.'));
    }
    if (finite(audio)) {
      judged = true;
      if (audio >= T.audioPerMinute) hints.push(hint('audio', 'Audio dropouts: ' + one(audio) + ' per minute. ' +
        'A higher audio buffer limit in Settings may help, at the cost of a little more audio delay.'));
    }
    if (finite(frames)) {
      judged = true;
      if (frames >= T.framesPerMinute) hints.push(hint('tv', 'The TV rejected or dropped ' + one(frames) + ' frames per minute. ' +
        'A lower resolution, frame rate or bitrate may help, at the cost of image detail or smoothness.'));
    }
    // The PC rule needs its frame rate: the time per frame is 1000 / fps.
    if (finite(host) && finite(fps) && fps > 0) {
      judged = true;
      if (host * fps >= T.hostFrame * 1000) hints.push(hint('host', 'The PC took ' + one(host) + ' ms per frame to process. ' +
        'Lowering the resolution or frame rate in the game may help.'));
    }
    if (!judged) return {status: 'none', hints: []};
    if (!hints.length) {
      return {status: 'stable', hints: [hint('stable', 'No problem found in this recording. There is nothing to adjust.')]};
    }
    return {status: 'hints', hints: hints};
  }

  // The same game at two bitrates, with frame gaps clearly only at the higher one.
  function forComparison(a, b) {
    if (!usable(a) || !usable(b)) return [];
    if (!a.game || a.game !== b.game || !a.config || !b.config) return [];
    var rateA = a.config.bitrate, rateB = b.config.bitrate;
    if (!finite(rateA) || !finite(rateB) || rateA === rateB) return [];
    var high = rateA > rateB ? a : b, low = high === a ? b : a;
    var highLoss = metric(high, 'lossPercent'), lowLoss = metric(low, 'lossPercent');
    if (!finite(highLoss) || !finite(lowLoss)) return [];
    if (highLoss < T.lossPercent || lowLoss >= highLoss / 2) return [];
    return [hint('bitrate-gaps', 'With ' + one(high.config.bitrate) + ' Mbps frame gaps reached ' + one(highLoss) +
      '%; with ' + one(low.config.bitrate) + ' Mbps they were ' + one(lowLoss) + '%. The lower bitrate gives less image detail.')];
  }
  return {THRESHOLDS: T, forRecord: forRecord, forComparison: forComparison};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DiagnosticHints;

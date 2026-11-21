'use strict';
// Suggestions computed only from the local session summaries already stored on the
// TV: fixed rules and thresholds, no new collection, no network, nothing automatic.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const context = vm.createContext({JSON, Object, Array, Number, String, Math, isFinite});
for (const name of ['diagnostic-history', 'diagnostic-hints']) vm.runInContext(fs.readFileSync('wasm/platform/' + name + '.js', 'utf8'), context);
const Hints = context.DiagnosticHints, History = context.DiagnosticHistory;
const plain = value => JSON.parse(JSON.stringify(value));
const MIN = 60000;

// A healthy five-minute record; tests change one thing at a time.
const record = (metrics = {}, overrides = {}) => ({version: 2, id: 'r' + Math.random(), createdAt: 1700000000000, durationMs: 5 * MIN, recordedMs: 5 * MIN,
  nativeMs: 5 * MIN, game: 'Artificial game', config: {bitrate: 50, audio: 'Stereo', audioLimitMs: 100, stream: '1920×1080 H264 60fps'},
  metrics: {lossPercent: 0.1, rttVariation: 2, audioUnderruns: 0, audioOverruns: 0, clientRejects: 0, browserDrops: 0, hostProcessing: 4, fpsHost: 60, ...metrics},
  rows: [], details: [], ...overrides});
const texts = record_ => plain(Hints.forRecord(record_).hints.map(hint => hint.text));
const ids = record_ => plain(Hints.forRecord(record_).hints.map(hint => hint.id));

// The thresholds live in one frozen place.
assert.deepStrictEqual(plain(Hints.THRESHOLDS), {minRecordedMs: 120000, lossPercent: 0.5, rttVariation: 10, audioPerMinute: 2,
  framesPerMinute: 5, hostFrame: 0.6});
assert.throws(() => { 'use strict'; Hints.THRESHOLDS.lossPercent = 9; });

// A healthy recording says so and suggests nothing to change.
{
  const result = Hints.forRecord(record());
  assert.strictEqual(result.status, 'stable');
  assert.deepStrictEqual(plain(result.hints.map(h => h.id)), ['stable']);
  assert.strictEqual(result.hints[0].text, 'No problem found in this recording. There is nothing to adjust.');
}

// Each problem appears exactly at its threshold and not below it, with its number.
const cases = [
  ['loss', {lossPercent: 0.5}, {lossPercent: 0.49}, 'Frame gaps reached 0.5%. This often points to network loss. A wired connection or 5 GHz Wi-Fi may help; a lower bitrate can reduce gaps at the cost of image detail.'],
  ['jitter', {rttVariation: 10}, {rttVariation: 9.9}, 'Network latency varied by 10 ms. Congested Wi-Fi is a common cause; a wired connection usually steadies it.'],
  ['audio', {audioUnderruns: 5, audioOverruns: 5}, {audioUnderruns: 5, audioOverruns: 4}, 'Audio dropouts: 2 per minute. A higher audio buffer limit in Settings may help, at the cost of a little more audio delay.'],
  ['tv', {clientRejects: 10, browserDrops: 15}, {clientRejects: 10, browserDrops: 14}, 'The TV rejected or dropped 5 frames per minute. A lower resolution, frame rate or bitrate may help, at the cost of image detail or smoothness.'],
  ['host', {hostProcessing: 10, fpsHost: 60}, {hostProcessing: 9.9, fpsHost: 60}, 'The PC took 10 ms per frame to process. Lowering the resolution or frame rate in the game may help.']
];
for (const [id, atThreshold, below, text] of cases) {
  assert.deepStrictEqual(ids(record(atThreshold)), [id], id + ' at the threshold');
  assert.deepStrictEqual(texts(record(atThreshold)), [text], id + ' text');
  assert.deepStrictEqual(ids(record(below)), ['stable'], id + ' just below the threshold');
}

// Counts are normalized by recorded time: the same count means less on a longer recording.
{
  assert.deepStrictEqual(ids(record({audioUnderruns: 10, audioOverruns: 0})), ['audio'], '10 dropouts in 5 minutes is 2 per minute');
}
{
  const longer = record({audioUnderruns: 10, audioOverruns: 0}, {recordedMs: 10 * MIN, durationMs: 10 * MIN});
  assert.deepStrictEqual(ids(longer), ['stable'], '10 dropouts in 10 minutes is 1 per minute: below the threshold');
}

// The host rule scales with the frame time: 60% of a frame.
{
  assert.deepStrictEqual(ids(record({hostProcessing: 12, fpsHost: 30})), ['stable'], '60% of 33 ms is 20 ms');
  assert.deepStrictEqual(ids(record({hostProcessing: 20, fpsHost: 30})), ['host']);
  assert.deepStrictEqual(ids(record({hostProcessing: 30, fpsHost: null})), ['stable'], 'without the PC frame rate the rule is skipped');
  assert.deepStrictEqual(ids(record({hostProcessing: 30, fpsHost: 0})), ['stable']);
}

// Several problems keep a fixed order; each shows its own number.
{
  const many = record({lossPercent: 1.26, rttVariation: 14.04, audioUnderruns: 15, audioOverruns: 0, clientRejects: 0, browserDrops: 30, hostProcessing: 11, fpsHost: 60});
  assert.deepStrictEqual(ids(many), ['loss', 'jitter', 'audio', 'tv', 'host']);
  const [loss, jitter, audio, tv, host] = texts(many);
  assert(loss.startsWith('Frame gaps reached 1.3%.'));
  assert(jitter.startsWith('Network latency varied by 14 ms.'));
  assert(audio.startsWith('Audio dropouts: 3 per minute.'));
  assert(tv.startsWith('The TV rejected or dropped 6 frames per minute.'));
  assert(host.startsWith('The PC took 11 ms per frame to process.'));
}

// Missing data skips that rule; with nothing to judge there is no message at all.
{
  assert.deepStrictEqual(ids(record({lossPercent: null})), ['stable']);
  assert.deepStrictEqual(ids(record({lossPercent: null, rttVariation: 12})), ['jitter']);
  const blind = record({lossPercent: null, rttVariation: null, audioUnderruns: null, audioOverruns: null, clientRejects: null, browserDrops: null, hostProcessing: null});
  assert.strictEqual(Hints.forRecord(blind).status, 'none');
  assert.deepStrictEqual(plain(Hints.forRecord(blind).hints), []);
}

// Short, partial-looking, legacy and malformed records never get suggestions.
{
  const bad = {lossPercent: 5, rttVariation: 50, audioUnderruns: 100, clientRejects: 100};
  assert.strictEqual(Hints.forRecord(record(bad, {recordedMs: 119999})).status, 'none', 'under 2 minutes');
  assert.strictEqual(Hints.forRecord(record(bad, {recordedMs: 120000})).status, 'hints', 'exactly 2 minutes counts');
  assert.strictEqual(Hints.forRecord(record(bad, {legacy: true})).status, 'none');
  for (const value of [null, undefined, {}, [], 'x', 5, {version: 1}, {version: 2, metrics: null}, {version: 2, recordedMs: 'x', metrics: {}}])
    assert.strictEqual(Hints.forRecord(value).status, 'none', JSON.stringify(value));
}

// A/B: the same game at two bitrates, gaps only at the higher one.
{
  const high = record({lossPercent: 2}, {config: {bitrate: 80}}), low = record({lossPercent: 0.2}, {config: {bitrate: 50}});
  const expected = 'With 80 Mbps frame gaps reached 2%; with 50 Mbps they were 0.2%. The lower bitrate gives less image detail.';
  for (const pair of [[high, low], [low, high]]) {
    const result = plain(Hints.forComparison(pair[0], pair[1]));
    assert.deepStrictEqual(result.map(h => h.id), ['bitrate-gaps']);
    assert.strictEqual(result[0].text, expected, 'order of A and B does not matter');
  }
  const none = (a, b) => assert.deepStrictEqual(plain(Hints.forComparison(a, b)), []);
  none(record({lossPercent: 2}, {config: {bitrate: 50}}), record({lossPercent: 0.2}, {config: {bitrate: 50}}));              // same bitrate
  none(record({lossPercent: 2}, {config: {bitrate: 80}, game: 'Other'}), low);                                               // another game
  none(record({lossPercent: 2}, {config: {bitrate: 80}, game: ''}), record({lossPercent: 0.2}, {config: {bitrate: 50}, game: ''})); // unknown game
  none(record({lossPercent: 0.4}, {config: {bitrate: 80}}), low);                                                            // high is not bad enough
  none(record({lossPercent: 2}, {config: {bitrate: 80}}), record({lossPercent: 1.5}, {config: {bitrate: 50}}));             // low is not clearly better
  none(record({lossPercent: 0.2}, {config: {bitrate: 80}}), record({lossPercent: 2}, {config: {bitrate: 50}}));             // worse at the lower bitrate
  none(record({lossPercent: null}, {config: {bitrate: 80}}), low);                                                           // no data
  none(record({lossPercent: 2}, {config: {bitrate: 80}, recordedMs: MIN}), low);                                            // too short
  none(record({lossPercent: 2}, {config: {bitrate: 80}, legacy: true}), low);
  none(record({lossPercent: 2}, {config: {bitrate: '80'}}), low);
  none(null, low); none(high, undefined);
}

// Per-minute values come from the history module, so the rules and the comparison table agree.
{
  const sample = record({audioUnderruns: 6}, {recordedMs: 3 * MIN});
  assert.strictEqual(History.metric(sample, 'audioUnderruns'), 2);
  assert.strictEqual(History.metric(sample, 'lossPercent'), 0.1);
  assert.strictEqual(History.metric(sample, 'nothing'), null);
  assert.strictEqual(History.metric({...sample, legacy: true}, 'lossPercent'), null);
}

// The rules only read: the record is unchanged, and there is no timer, DOM or network in the module.
{
  const r = record({lossPercent: 3});
  const before = JSON.stringify(r);
  Hints.forRecord(r); Hints.forComparison(r, record({lossPercent: 0}, {config: {bitrate: 20}}));
  assert.strictEqual(JSON.stringify(r), before);
  const source = fs.readFileSync('wasm/platform/diagnostic-hints.js', 'utf8');
  assert(!/setTimeout|setInterval|requestAnimationFrame|XMLHttpRequest|fetch\(|document\.|localStorage|console\./.test(source));
}
// Every suggestion is translated by the real menu translator, with its numbers in place.
{
  const catalog = vm.createContext({});
  vm.runInContext(fs.readFileSync(process.env.ML_CATALOG_FOR_TEST || 'wasm/platform/menu-translations.js', 'utf8'), catalog);
  const rows = vm.runInContext('MenuTranslations', catalog);
  const sources = [
    record({lossPercent: 1.26, rttVariation: 14.04, audioUnderruns: 15, audioOverruns: 0, clientRejects: 0, browserDrops: 30, hostProcessing: 11, fpsHost: 60}),
    record()];
  const hintTexts = [].concat(...sources.map(r => plain(Hints.forRecord(r).hints.map(h => h.text))));
  hintTexts.push(plain(Hints.forComparison(record({lossPercent: 2}, {config: {bitrate: 80}}), record({lossPercent: 0.2}, {config: {bitrate: 50}})))[0].text);
  assert.strictEqual(hintTexts.length, 7, 'all seven suggestion texts are exercised');
  for (const language of ['pt-BR', 'es']) {
    const sandbox = vm.createContext({MenuTranslations: rows, navigator: {language}, localStorage: {getItem() { return null; }}, document: {addEventListener() {}}});
    vm.runInContext(fs.readFileSync('wasm/platform/menu-i18n.js', 'utf8'), sandbox);
    for (const text of hintTexts) {
      const translated = vm.runInContext('MenuI18n.text', sandbox)(text);
      assert.notStrictEqual(translated, text, language + ' translation missing for: ' + text.slice(0, 50));
      assert(!/\{\d+\}/.test(translated), language + ' placeholder left: ' + translated.slice(0, 60));
      const numbers = (text.match(/[0-9]+(?:\.[0-9]+)?/g) || []).filter(n => n !== '5');   // "5 GHz" is fixed text
      for (const number of numbers) assert(translated.includes(number), language + ' lost the number ' + number);
    }
  }
}
console.log('diagnostic_hints_test: approved rules and thresholds, per-minute counts, host frame time, fixed order, missing data, short/legacy records, A/B by bitrate, read-only and pt-BR/es translations PASS');

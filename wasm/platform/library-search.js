// Library search rules: a game matches when the typed text is part of its name, ignoring case and
// accents; an empty search matches everything. No DOM, no timers.
var LibrarySearch = (function() {
  'use strict';
  function normalize(value) {
    var text = value === undefined || value === null ? '' : String(value);
    // Decompose accents when the engine can, then drop the combining marks.
    if (typeof text.normalize === 'function') text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function matches(title, query) {
    var wanted = normalize(query);
    if (wanted === '') return true;
    return normalize(title).indexOf(wanted) !== -1;
  }
  // The games whose title matches, in the same order and as the same objects.
  function filter(games, query) {
    if (!games || typeof games.filter !== 'function') return [];
    return games.filter(function(game) { return matches(game && game.title, query); });
  }
  return { normalize: normalize, matches: matches, filter: filter };
})();

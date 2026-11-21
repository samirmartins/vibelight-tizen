// Text typed on the TV and sent to the PC from the stream menu. The text is
// encoded as UTF-8 and sent in blocks of at most 32 bytes (one protocol text
// event), never splitting a character. Work happens only when the user sends;
// no timer or listener exists here and nothing runs during normal play.
var StreamText = (function() {
  var MAX_CHARACTERS = 256, BLOCK_BYTES = 32;

  function isControl(codePoint) {
    return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
  }
  // Code points of a string; an unpaired surrogate becomes U+FFFD.
  function codePointsOf(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var unit = text.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          out.push(0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00));
          i++;
          continue;
        }
      }
      out.push(unit >= 0xd800 && unit <= 0xdfff ? 0xfffd : unit);
    }
    return out;
  }
  function utf8Of(codePoint) {
    if (codePoint < 0x80) return [codePoint];
    if (codePoint < 0x800) return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)];
    if (codePoint < 0x10000) {
      return [0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f)];
    }
    return [0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f),
      0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f)];
  }
  function clean(text) {
    return typeof text === 'string' ? codePointsOf(text).filter(function(point) { return !isControl(point); }) : [];
  }
  function sanitize(text) {
    var points = clean(text), out = '';
    for (var i = 0; i < points.length; i++) out += String.fromCodePoint(points[i]);
    return out;
  }
  // Blocks of whole characters, each at most 32 bytes.
  function blocks(text) {
    var out = [], block = [];
    clean(text).forEach(function(point) {
      var encoded = utf8Of(point);
      if (block.length + encoded.length > BLOCK_BYTES) { out.push(block); block = []; }
      block = block.concat(encoded);
    });
    if (block.length) out.push(block);
    return out;
  }

  function send(text) {
    var points = clean(text);
    if (!points.length) return {ok: false, reason: 'empty'};
    if (points.length > MAX_CHARACTERS) return {ok: false, reason: 'too-long'};
    if (typeof isInGame === 'undefined' || !isInGame) return {ok: false, reason: 'no-stream'};
    if (typeof Module === 'undefined' || !Module || typeof Module._utf8TextBuffer !== 'function' ||
        typeof Module._sendUtf8Text !== 'function' || !Module.HEAP32) return {ok: false, reason: 'unavailable'};
    var parts = blocks(text), sent = 0;
    try {
      for (var i = 0; i < parts.length; i++) {
        var view = new Uint8Array(Module.HEAP32.buffer, Module._utf8TextBuffer() >>> 0, BLOCK_BYTES);
        view.set(parts[i]);
        if (Module._sendUtf8Text(parts[i].length) !== 0) return {ok: false, reason: 'failed', sent: sent};
        sent++;
      }
    } catch (e) {
      return {ok: false, reason: 'failed', sent: sent};
    }
    return {ok: true, blocks: sent};
  }
  return {send: send, blocks: blocks, sanitize: sanitize, MAX_CHARACTERS: MAX_CHARACTERS};
})();

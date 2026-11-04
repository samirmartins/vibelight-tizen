'use strict';
// Samsung Emscripten std::string C++ -> JS: bounded reads, no temporary heap write.
// Strategy adapted from mmadej20 / BrightCraft PR #185 (GPL-3.0), revision d8d4ae4:
// https://github.com/brightcraft/moonlight-tizen/pull/185
// Keep this build-only tool compatible with the SDK's Node 12.
const fs = require('fs');
const PREFIX = 'if(stdStringIsUTF8){';
const ORIGINAL = PREFIX +
  'var endChar=HEAPU8[value+4+length];var endCharSwap=0;if(endChar!=0){endCharSwap=endChar;HEAPU8[value+4+length]=0}' +
  'var decodeStartPtr=value+4;for(var i=0;i<=length;++i){var currentBytePtr=value+4+i;if(HEAPU8[currentBytePtr]==0){' +
  'var stringSegment=UTF8ToString(decodeStartPtr);if(str===undefined)str=stringSegment;else{str+=String.fromCharCode(0);' +
  'str+=stringSegment}decodeStartPtr=currentBytePtr+1}}if(endCharSwap!=0)HEAPU8[value+4+length]=endCharSwap}';
const PATCHED = PREFIX +
  'var decodeStartPtr=value+4;for(var i=0;i<=length;++i){var currentBytePtr=value+4+i;if(i==length||HEAPU8[currentBytePtr]==0){' +
  'var stringSegment=UTF8ToString(decodeStartPtr,currentBytePtr-decodeStartPtr);if(str===undefined)str=stringSegment;else{' +
  'str+=String.fromCharCode(0);str+=stringSegment}decodeStartPtr=currentBytePtr+1}}}';
function count(source, pattern) { return source.split(pattern).length - 1; }
function verifySource(source) {
  if (source.includes('endChar=HEAPU8[value+4+length]') || count(source, ORIGINAL)) {
    throw Error('Unsafe std::string converter remains in the generated module');
  }
  const found = count(source, PATCHED);
  if (found !== 1) throw Error('Protected std::string converter found ' + found + ' times; expected exactly once');
}
function patchSource(source) {
  const found = count(source, ORIGINAL);
  if (found !== 1) throw Error('Original std::string converter found ' + found + ' times; expected exactly once');
  if (count(source, PATCHED)) throw Error('Mixed original and already protected converters');
  const result = source.replace(ORIGINAL, PATCHED);
  verifySource(result);
  return result;
}
module.exports = { patchSource, verifySource, ORIGINAL, PATCHED };
if (require.main === module) {
  const args = process.argv.slice(2), check = args[0] === '--check';
  if (check) args.shift();
  if (args.length !== 1 || (!check && args[0] === '-')) {
    console.error('Usage: node patch-embind-string.cjs [--check] <moonlight-wasm.js> (check accepts - for stdin)');
    process.exitCode = 2;
  } else {
    try {
      const file = args[0], source = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
      if (check) verifySource(source);
      else fs.writeFileSync(file, patchSource(source));
      console.log(check ? 'Embind std::string protection verified' : 'Embind std::string protection applied');
    } catch (error) {
      console.error('Embind protection failed: ' + error.message);
      process.exitCode = 1;
    }
  }
}

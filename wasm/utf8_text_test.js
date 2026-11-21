'use strict';
// Compile the real wasm/input.cpp and exercise the text bridge: JavaScript fills a
// 32-byte buffer and asks for one protocol text event. The transport is a boundary;
// this does not prove behavior on the Samsung runtime or on a host.
const fs = require('fs'), cp = require('child_process'), os = require('os'), path = require('path');
const source = fs.readFileSync('wasm/input.cpp', 'utf8');
let fixture = fs.readFileSync('wasm/fixtures/input-stubs.cpp', 'utf8');
const tests = `
int main() {
  MoonlightInstance app; g_Instance = &app;
  char* buffer = static_cast<char*>(utf8TextBuffer());
  assert(buffer != nullptr);
  assert(utf8TextBuffer() == buffer);                       // the address never moves
  for (int i = 0; i < 32; ++i) buffer[i] = static_cast<char>('a' + i % 26);   // all 32 bytes are writable

  // Only 1..32 bytes make one event; anything else is refused before the library.
  for (int bad : {0, -1, 33, 64, 1000, -32768}) { assert(sendUtf8Text(bad) == -3); }
  assert(texts.empty());

  // The bytes sent are exactly the buffer prefix, including a multi-byte character.
  const char accented[] = "ol\\xC3\\xA1 \\xE2\\x82\\xAC \\xF0\\x9F\\x98\\x80";   // olá € 😀 (4 + 3 + 4 bytes of non-ASCII)
  const int length = static_cast<int>(sizeof(accented)) - 1;
  for (int i = 0; i < length; ++i) buffer[i] = accented[i];
  assert(sendUtf8Text(length) == 0);
  assert(texts.size() == 1 && texts[0] == std::string(accented, length));
  for (int i = 0; i < 32; ++i) buffer[i] = static_cast<char>('A' + i % 26);
  assert(sendUtf8Text(32) == 0);                              // the largest event
  assert(texts.size() == 2 && texts[1].size() == 32 && texts[1][31] == 'F');
  assert(sendUtf8Text(1) == 0 && texts.size() == 3 && texts[2] == "A");

  // An embedded NUL is data, not a terminator.
  buffer[0] = 'x'; buffer[1] = 0; buffer[2] = 'y';
  assert(sendUtf8Text(3) == 0 && texts[3] == std::string("x\\0y", 3));

  // A library error is reported, not hidden.
  textResult = -1;
  assert(sendUtf8Text(2) == -1);
  textResult = 0;

  // No session, or one that is stopping: nothing is sent.
  const size_t before = texts.size();
  app.m_Running = false;
  assert(sendUtf8Text(1) == -2);
  app.m_Running = true;
  g_Instance = nullptr;
  assert(sendUtf8Text(1) == -2);
  g_Instance = &app;
  assert(texts.size() == before);

  // Text never goes through the keyboard or mouse paths.
  assert(events.empty());
  std::cout << "utf8 text native: bounds, exact bytes, NUL, error, no-session and no key events PASS\\n";
  return 0;
}
`;
fixture = fixture.replace('#include <cassert>', '#include <cassert>\n#include <iostream>\n#include <string>');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlight-text-test-'));
try {
  const file = path.join(dir, 'test.cpp'), bin = path.join(dir, 'test');
  fs.writeFileSync(file, fixture + source.replace('#include "moonlight_wasm.hpp"', '') + tests);
  cp.execFileSync('g++', ['-std=c++17', '-O1', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
    '-Imoonlight-common-c/src', file, '-o', bin], {stdio: 'inherit'});
  cp.execFileSync(bin, [], {stdio: 'inherit', env: {...process.env, ASAN_OPTIONS: 'detect_leaks=1', UBSAN_OPTIONS: 'halt_on_error=1'}});
} finally { fs.rmSync(dir, {recursive: true, force: true}); }
console.log('utf8_text_test: real input.cpp text bridge compiled with ASan/UBSan PASS');

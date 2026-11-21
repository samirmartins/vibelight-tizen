'use strict';
// Compile the complete production DOM input implementation with browser fixtures.
const fs = require('fs'), cp = require('child_process'), path = require('path'), assert = require('assert');
const source = fs.readFileSync('wasm/input.cpp', 'utf8');
const main = fs.readFileSync('wasm/main.cpp', 'utf8');
assert.match(main, /emscripten_set_blur_callback\(EMSCRIPTEN_EVENT_TARGET_WINDOW, NULL, EM_TRUE, handleFocusLost\)/);
assert.match(main, /emscripten_set_visibilitychange_callback\(NULL, EM_TRUE, handleVisibilityChange\)/);
const fixture = fs.readFileSync('wasm/fixtures/input-stubs.cpp', 'utf8');
const tests = `
int main() {
 MoonlightInstance app; g_Instance = &app;
 EmscriptenKeyboardEvent key; key.keyCode = 0x41;
 app.HandleKeyDown(key); app.HandleKeyDown(key);
 EmscriptenMouseEvent mouse;
 for (int i = 0; i < 3; ++i) { mouse.button = i; app.HandleMouseDown(mouse); }
 assert(events.size() == 5 && app.m_HeldKeys.count() == 1 && app.m_HeldMouseButtons.count() == 3);
 handleFocusLost(0, nullptr, nullptr);
 assert(events.size() == 9 && app.m_HeldKeys.none() && app.m_HeldMouseButtons.none());
 assert(events[5].type == 0 && events[5].code == 0x8041 && events[5].action == KEY_ACTION_UP && events[5].modifiers == 0);
 for (int i = 6; i < 9; ++i) assert(events[i].type == 1 && events[i].action == BUTTON_ACTION_RELEASE);
 handleFocusLost(0, nullptr, nullptr); assert(events.size() == 9);
 assert(app.stops == 0 && app.m_Running);
 app.HandleKeyDown(key); app.HandleKeyUp(key); auto size = events.size();
 app.ReleaseHeldInput(); assert(events.size() == size);
 app.HandleKeyDown(key);
 EmscriptenVisibilityChangeEvent visible{false}, hidden{true};
 handleVisibilityChange(0, &visible, nullptr); assert(app.m_HeldKeys.any());
 handleVisibilityChange(0, nullptr, nullptr); assert(app.stops == 0);
 handleVisibilityChange(0, &hidden, nullptr); assert(app.m_HeldKeys.none());
 assert(app.stops == 1 && !app.m_Running);
 app.m_Running = true;
 sendKeyboardEvent(0x801b, KEY_ACTION_DOWN, 0); assert(app.m_HeldKeys.test(0x1b));
 EmscriptenPointerlockChangeEvent lock{false}; handlePointerLockChange(0, &lock, nullptr);
 assert(!app.m_MouseLocked && app.m_HeldKeys.none() && events.back().code == 0x801b);
 size = events.size(); app.HandleKeyDown(key); assert(events.size() == size);
 app.m_MouseLocked = true; app.HandleKeyDown(key); app.m_Running = false;
 size = events.size(); app.ReleaseHeldInput(); assert(events.size() == size && app.m_HeldKeys.none());
 app.m_Running = true; app.HandleKeyDown(key); app.HandleKeyUp(key);
 size = events.size(); app.ReleaseHeldInput(); assert(events.size() == size);
 mouse.button = 7; app.HandleMouseDown(mouse); assert(app.m_HeldMouseButtons.none());
 return 0;
}
`;
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'moonlight-focus-test-'));
try {
 const file = path.join(tmp, 'test.cpp'), bin = path.join(tmp, 'test');
 fs.writeFileSync(file, fixture + source.replace('#include "moonlight_wasm.hpp"', '') + tests);
 cp.execFileSync('g++', ['-std=c++17', '-O1', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
  '-Imoonlight-common-c/src', file, '-o', bin], {stdio: 'inherit'});
 cp.execFileSync(bin, [], {stdio: 'inherit', env: {...process.env, ASAN_OPTIONS: 'detect_leaks=1', UBSAN_OPTIONS: 'halt_on_error=1'}});
} finally { fs.rmSync(tmp, {recursive: true, force: true}); }
console.log('input_focus_test: production key/mouse tracking, blur, visibility, pointer-lock loss and idempotent release OK');

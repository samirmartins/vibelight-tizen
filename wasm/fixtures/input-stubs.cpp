// Emscripten/moonlight-common-c stubs for compiling wasm/input.cpp natively in tests.
#include <atomic>
#include <bitset>
#include <vector>
#include <cassert>
#include <string>
#include <cstdint>
#include <cstddef>
#include "Limelight.h"
using EM_BOOL = bool;
#define EM_TRUE true
#define EM_FALSE false
#define EMSCRIPTEN_BINDINGS(name) void bind_##name()
struct EmscriptenMouseEvent { unsigned short button = 0; int screenX = 0, screenY = 0, movementX = 0, movementY = 0; };
struct EmscriptenKeyboardEvent { bool ctrlKey = false, altKey = false, shiftKey = false; uint32_t keyCode = 0; };
struct EmscriptenWheelEvent { double deltaY = 0; };
struct EmscriptenPointerlockChangeEvent { bool isActive; };
struct EmscriptenFocusEvent {};
struct EmscriptenVisibilityChangeEvent { bool hidden; };
struct Event { int type, code, action, modifiers; };
std::vector<Event> events;
extern "C" int LiSendKeyboardEvent(short code, char action, char modifiers) { events.push_back({0, (uint16_t)code, action, modifiers}); return 0; }
extern "C" int LiSendMouseButtonEvent(char action, int code) { events.push_back({1, code, action, 0}); return 0; }
extern "C" int LiSendMouseMoveEvent(short x, short y) { events.push_back({2, x, y, 0}); return 0; }
extern "C" int LiSendHighResScrollEvent(short ticks) { events.push_back({3, ticks, 0, 0}); return 0; }
extern "C" void LiRequestIdrFrame(void) {}
#ifndef EMSCRIPTEN_KEEPALIVE
#define EMSCRIPTEN_KEEPALIVE
#endif
std::vector<std::string> texts;
int textResult = 0;
extern "C" int LiSendUtf8TextEvent(const char* text, unsigned int length) { texts.emplace_back(text, length); return textResult; }
namespace emscripten { template<class T> void function(const char*, T) {} }
static const char* kCanvasName = "fixture";
void emscripten_request_pointerlock(const char*, bool) {}
void emscripten_exit_pointerlock() {}
void NotifyInputEvent() {}
void stopStream() {}
void toggleStats() {}
class MoonlightInstance {
public:
 bool m_MouseLocked = true, m_WaitingForAllModifiersUp = false;
 std::atomic<bool> m_Running{true};
 std::bitset<256> m_HeldKeys;
 std::bitset<8> m_HeldMouseButtons;
 long m_MouseLastPosX = -1, m_MouseLastPosY = -1;
 std::atomic<int32_t> m_MouseDeltaX{0}, m_MouseDeltaY{0}, m_AccumulatedTicks{0};
 EM_BOOL HandleMouseDown(const EmscriptenMouseEvent&);
 EM_BOOL HandleMouseUp(const EmscriptenMouseEvent&);
 EM_BOOL HandleMouseMove(const EmscriptenMouseEvent&);
 EM_BOOL HandleWheel(const EmscriptenWheelEvent&);
 EM_BOOL HandleKeyDown(const EmscriptenKeyboardEvent&);
 EM_BOOL HandleKeyUp(const EmscriptenKeyboardEvent&);
 void SendKeyboardInput(uint32_t, uint16_t, char);
 void ReleaseHeldInput(); void ReportMouseMovement();
 int stops = 0;
 void StopConnection() { assert(m_HeldKeys.none() && m_HeldMouseButtons.none()); ++stops; m_Running = false; }
 void LockMouse(); void UnlockMouse(); void DidLockMouse(int32_t); void MouseLockLost();
 static void ClLogMessage(const char*, ...) {}
};
MoonlightInstance* g_Instance;

#include "moonlight_wasm.hpp"

#include <atomic>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>

#include <Limelight.h>
#include <emscripten/emscripten.h>
#include <emscripten/threading.h>

// Bitmask for gamepad combo buttons to stop the streaming session
const short STOP_STREAM_BUTTONS = BACK_FLAG | PLAY_FLAG | LB_FLAG | RB_FLAG;

// Bitmask for gamepad combo buttons to toggle the performance stats overlay
const short PERF_STATS_BUTTONS = BACK_FLAG | LB_FLAG | RB_FLAG | X_FLAG;

// Flag for gamepad to track controller rumble state
std::atomic<bool> rumbleFeedbackSwitch{false};

// Flags for gamepad to track mouse emulation state
bool mouseEmulationSwitch = false;
bool mouseEmulationActive = false;

// For explanation on ordering, see: https://www.w3.org/TR/gamepad/#remapping
// Enumeration for gamepad buttons
enum GamepadButton {
  A, B, X, Y,
  LeftBumper, RightBumper,
  LeftTrigger, RightTrigger,
  Back, Play,
  LeftStick, RightStick,
  Up, Down, Left, Right,
  Special,
  Count,
};

// For explanation on ordering, see: https://www.w3.org/TR/gamepad/#remapping
// Enumeration for gamepad axis
enum GamepadAxis {
  LeftX = 0,
  LeftY = 1,
  RightX = 2,
  RightY = 3,
};

// Gamepad state as the main thread hands it over.
//
// The Emscripten gamepad functions cannot be used from here. All three of them
// (emscripten_sample_gamepad_data, emscripten_get_num_gamepads and
// emscripten_get_gamepad_status) are declared __proxy: 'sync' in the SDK,
// because the Gamepad API only exists on the main thread. Calling them from this
// worker blocks it and queues work on the main thread, and this loop runs every
// 5 ms: with one controller that is six hundred synchronous round trips a
// second, on the same thread that schedules audio and services the media
// pipeline. It was the largest consumer of main thread time in the application.
//
// So the direction is inverted. A requestAnimationFrame loop in
// platform/gamepad.js reads navigator.getGamepads() where it already lives,
// writes the result here, and this side just reads memory. No proxying, and the
// sampling rate becomes the display's, which is the useful rate for input.
//
// Plain arithmetic types only: this is written by JS through the heap views.
static constexpr int kMaxSnapshotPads = 4;

struct GamepadState {
  int32_t connected;
  int32_t numAxes;
  int32_t numButtons;
  // JS filters phantom pads before publication. This formerly unused word now
  // distinguishes owners reusing a browser slot without changing the ABI.
  int32_t connectionGeneration;
  int32_t controllerType;
  int32_t capabilities;
  int32_t supportedButtonFlags;
  float axis[8];
  float analogButton[GamepadButton::Count];
  int32_t digitalButton[GamepadButton::Count];
};

struct GamepadSnapshot {
  int32_t numGamepads;
  GamepadState pads[kMaxSnapshotPads];
};

// Every member is four bytes wide and four byte aligned, so the layout has no
// padding and JS can index it with the HEAP32 and HEAPF32 views directly. The
// assertions exist so that adding a field of another width fails the build here
// rather than silently misaligning the writer on the other side.
static_assert(sizeof(GamepadState) ==
                (7 + 8 + GamepadButton::Count + GamepadButton::Count) * 4,
              "GamepadState has padding; platform/gamepad.js indexes it directly");
static_assert(sizeof(GamepadSnapshot) == 4 + kMaxSnapshotPads * sizeof(GamepadState),
              "GamepadSnapshot has padding; platform/gamepad.js indexes it directly");

static constexpr size_t kSnapshotWords = sizeof(GamepadSnapshot) / sizeof(uint32_t);
alignas(4) static uint32_t s_gpSharedWords[kSnapshotWords + 1] = {};

alignas(4) static uint32_t s_inputWakeGeneration = 0;
static std::atomic<uint32_t> s_gamepadSession{0};
// True only while an unchanged snapshot still needs time-based work: a held
// stick driving mouse emulation or the one-second mouse-mode long press.
static std::atomic<bool> s_inputNeedsTimedWake{false};
// Set only by the system overlay. Native input remains the single writer of
// host packets, so suppression is one atomic neutral transition, not a JS race.
static std::atomic<bool> s_inputSuppressed{false};

// Optional analog shaping. Two packed 32-bit words are published through a
// seqlock, so the input thread never reads a torn configuration and no 64-bit
// atomic is required on older WASM runtimes. Default 0 is neutral.
static std::atomic<uint32_t> s_tuningGeneration{0};
static std::atomic<uint32_t> s_tuningLow{0};
static std::atomic<uint32_t> s_tuningHigh{0};

struct GamepadTuning {
  bool enabled;
  float deadzone;
  float curve;
  int invertLeft;
  int invertRight;
  bool swapSticks;
  float triggerThreshold;
};

static GamepadTuning ReadGamepadTuning() {
  GamepadTuning tuning = {};
  for (;;) {
    const uint32_t before = s_tuningGeneration.load(std::memory_order_acquire);
    if ((before & 1u) != 0) continue;
    const uint32_t low = s_tuningLow.load(std::memory_order_relaxed);
    const uint32_t high = s_tuningHigh.load(std::memory_order_relaxed);
    const uint32_t after = s_tuningGeneration.load(std::memory_order_acquire);
    if (before != after) continue;
    tuning.enabled = (high & 0x1u) != 0;
    tuning.deadzone = static_cast<float>(low & 0x3ffu) / 1000.0f;
    tuning.curve = static_cast<float>((low >> 10) & 0xffu) / 100.0f;
    tuning.invertLeft = static_cast<int>((low >> 18) & 0x3u);
    tuning.invertRight = static_cast<int>((low >> 20) & 0x3u);
    tuning.swapSticks = (high & 0x2u) != 0;
    tuning.triggerThreshold = static_cast<float>((high >> 2) & 0x3ffu) / 1000.0f;
    return tuning;
  }
}

extern "C" EMSCRIPTEN_KEEPALIVE void configureGamepadTuning(
  int enabled, int deadzoneX1000, int curveX100, int invertLeft, int invertRight,
  int swapSticks, int triggerThresholdX1000) {
  const uint32_t deadzone = static_cast<uint32_t>(std::max(0, std::min(500, deadzoneX1000))) & 0x3ffu;
  const uint32_t curve = static_cast<uint32_t>(std::max(50, std::min(200, curveX100))) & 0xffu;
  const uint32_t left = static_cast<uint32_t>(std::max(0, std::min(3, invertLeft)));
  const uint32_t right = static_cast<uint32_t>(std::max(0, std::min(3, invertRight)));
  const uint32_t threshold = static_cast<uint32_t>(std::max(0, std::min(500, triggerThresholdX1000))) & 0x3ffu;
  const uint32_t low = deadzone | (curve << 10) | (left << 18) | (right << 20);
  const uint32_t high = (enabled ? 1u : 0u) | (swapSticks ? 2u : 0u) | (threshold << 2);
  s_tuningGeneration.fetch_add(1, std::memory_order_acq_rel);
  s_tuningLow.store(low, std::memory_order_relaxed);
  s_tuningHigh.store(high, std::memory_order_relaxed);
  s_tuningGeneration.fetch_add(1, std::memory_order_release);
}

extern "C" EMSCRIPTEN_KEEPALIVE void setInputSuppressed(int suppressed) {
  s_inputSuppressed.store(suppressed != 0, std::memory_order_release);
}

// Copies a coherent snapshot. Every payload word is accessed atomically on
// both sides of the WASM heap; the sequence word detects an update that began
// during the copy and retries it. This removes the C++ data race from the old
// plain struct while keeping the main-thread publisher lock-free.
static bool ReadGamepadSnapshot(GamepadSnapshot& output, uint32_t& sequence) {
  auto* destination = reinterpret_cast<uint32_t*>(&output);
  for (int attempt = 0; attempt < 3; attempt++) {
    const uint32_t before = __atomic_load_n(&s_gpSharedWords[0], __ATOMIC_ACQUIRE);
    if (before & 1) {
      continue;
    }
    for (size_t i = 0; i < kSnapshotWords; i++) {
      destination[i] = __atomic_load_n(&s_gpSharedWords[i + 1], __ATOMIC_RELAXED);
    }
    const uint32_t after = __atomic_load_n(&s_gpSharedWords[0], __ATOMIC_ACQUIRE);
    if (before == after && !(after & 1)) {
      sequence = after;
      return true;
    }
  }
  return false;
}

// Handed to JS once, when the input loop starts.
extern "C" EMSCRIPTEN_KEEPALIVE void* gamepadSnapshotAddress() {
  return &s_gpSharedWords[0];
}

extern "C" EMSCRIPTEN_KEEPALIVE int gamepadSnapshotMaxPads() {
  return kMaxSnapshotPads;
}

extern "C" EMSCRIPTEN_KEEPALIVE int gamepadSnapshotButtonCount() {
  return GamepadButton::Count;
}

// Exported so the writer does not have to reproduce the arithmetic
extern "C" EMSCRIPTEN_KEEPALIVE int gamepadSnapshotStride() {
  return (int)sizeof(GamepadState);
}

extern "C" EMSCRIPTEN_KEEPALIVE int gamepadSnapshotWordCount() {
  return (int)kSnapshotWords;
}

void NotifyInputEvent() {
  __atomic_add_fetch(&s_inputWakeGeneration, 1, __ATOMIC_RELEASE);
  // Waking a worker does not acquire a mutex or wait for the browser thread.
  emscripten_futex_wake(&s_inputWakeGeneration, 1);
}

void WaitForInputEvent(uint32_t& observedGeneration, int timeoutMs) {
  uint32_t current = __atomic_load_n(&s_inputWakeGeneration, __ATOMIC_ACQUIRE);
  if (current == observedGeneration) {
    // Compare-and-sleep is atomic: a notification between this load and the
    // wait changes the word, so the worker cannot sleep through that event.
    // Only the input worker calls this; the browser thread must never wait.
    emscripten_futex_wait(&s_inputWakeGeneration, current,
      timeoutMs < 0 ? std::numeric_limits<double>::infinity()
                    : static_cast<double>(timeoutMs));
    current = __atomic_load_n(&s_inputWakeGeneration, __ATOMIC_ACQUIRE);
  }
  observedGeneration = current;
}

bool InputNeedsTimedWake() {
  return s_inputNeedsTimedWake.load(std::memory_order_acquire);
}

extern "C" EMSCRIPTEN_KEEPALIVE void notifyGamepadSnapshot() {
  NotifyInputEvent();
}

// Function to create a mask for active gamepads
static short GetActiveGamepadMask(const GamepadSnapshot& snapshot, int numGamepads) {
  short result = 0;
  
  for (int i = 0; i < numGamepads; ++i) {
    if (snapshot.pads[i].connected) {
      result |= (1 << i);
    }
  }
  
  return result;
}

// Function to map gamepad buttons to flags
static int GetButtonFlags(const GamepadState& gamepad) {
  // Triggers are considered analog buttons in the "Emscripten API", however they need
  // to be passed in separate arguments for "Limelight" (it even lacks flags for them).

  // Define default button mapping
  static const int buttonMasks[] = {
    A_FLAG, B_FLAG, X_FLAG, Y_FLAG,
    LB_FLAG, RB_FLAG,
    0 /* LT_FLAG */, 0 /* RT_FLAG */,
    BACK_FLAG, PLAY_FLAG,
    LS_CLK_FLAG, RS_CLK_FLAG,
    UP_FLAG, DOWN_FLAG, LEFT_FLAG, RIGHT_FLAG,
    SPECIAL_FLAG,
  };
  constexpr int buttonMasksSize = sizeof(buttonMasks) / sizeof(buttonMasks[0]);

  int result = 0;
  
  for (int i = 0; i < gamepad.numButtons && i < buttonMasksSize; ++i) {
    if (gamepad.digitalButton[i] != 0) {
      result |= buttonMasks[i];
    }
  }

  return result;
}

// Function to handle the gamepad input state
void MoonlightInstance::HandleGamepadInputState(bool rumbleFeedback, bool mouseEmulation) {
  rumbleFeedbackSwitch.store(rumbleFeedback, std::memory_order_release);
  mouseEmulationSwitch = mouseEmulation;
  mouseEmulationActive = false;
  s_inputNeedsTimedWake.store(false, std::memory_order_release);
  s_inputSuppressed.store(false, std::memory_order_release);
  s_gamepadSession.fetch_add(1, std::memory_order_release);
}

struct ControllerPacketState {
  int buttonFlags;
  unsigned char leftTrigger;
  unsigned char rightTrigger;
  short leftStickX;
  short leftStickY;
  short rightStickX;
  short rightStickY;
};

static float ClampAxis(float value) {
  if (!std::isfinite(value)) {
    return 0.0f;
  }
  return std::max(-1.0f, std::min(1.0f, value));
}

static float ClampTrigger(float value) {
  if (!std::isfinite(value)) {
    return 0.0f;
  }
  return std::max(0.0f, std::min(1.0f, value));
}

// Disabled tuning returns the original clamp result. Enabled tuning shapes the
// value after the same clamp, so the neutral configuration is bit-identical.
static float ShapeAxis(const GamepadTuning& tuning, float value) {
  value = ClampAxis(value);
  if (!tuning.enabled) {
    return value;
  }
  const float magnitude = std::fabs(value);
  if (tuning.deadzone > 0.0f) {
    if (magnitude <= tuning.deadzone) {
      return 0.0f;
    }
    value = std::copysign((magnitude - tuning.deadzone) / (1.0f - tuning.deadzone), value);
  }
  if (tuning.curve != 1.0f) {
    value = std::copysign(std::pow(std::fabs(value), tuning.curve), value);
  }
  return value;
}

static float ShapeTrigger(const GamepadTuning& tuning, float value) {
  value = ClampTrigger(value);
  if (!tuning.enabled || tuning.triggerThreshold <= 0.0f) {
    return value;
  }
  if (value <= tuning.triggerThreshold) {
    return 0.0f;
  }
  return (value - tuning.triggerThreshold) / (1.0f - tuning.triggerThreshold);
}

// Function to poll gamepad input
void MoonlightInstance::PollGamepads() {
  static GamepadSnapshot snapshot = {};
  static uint32_t lastSequence = UINT32_MAX;
  static short lastConnectedMask = 0;
  static int32_t lastConnectionGeneration[kMaxSnapshotPads] = {};
  static ControllerPacketState lastPacket[kMaxSnapshotPads] = {};
  static bool packetValid[kMaxSnapshotPads] = {};
  static bool comboTriggered[kMaxSnapshotPads] = {};
  static bool guideLatched[kMaxSnapshotPads] = {};
  static bool longPressLatched[kMaxSnapshotPads] = {};
  static std::chrono::steady_clock::time_point playPressedAt[kMaxSnapshotPads] = {};
  static unsigned char mouseButtonMask = 0;
  static uint32_t activeSession = UINT32_MAX;

  const uint32_t session = s_gamepadSession.load(std::memory_order_acquire);
  if (session != activeSession) {
    activeSession = session;
    lastSequence = UINT32_MAX;
    lastConnectedMask = 0;
    std::memset(lastConnectionGeneration, 0, sizeof(lastConnectionGeneration));
    std::memset(lastPacket, 0, sizeof(lastPacket));
    std::memset(packetValid, 0, sizeof(packetValid));
    std::memset(comboTriggered, 0, sizeof(comboTriggered));
    std::memset(guideLatched, 0, sizeof(guideLatched));
    std::memset(longPressLatched, 0, sizeof(longPressLatched));
    for (auto& pressedAt : playPressedAt) {
      pressedAt = {};
    }
    mouseButtonMask = 0;
  }

  const uint32_t publishedSequence =
    __atomic_load_n(&s_gpSharedWords[0], __ATOMIC_ACQUIRE);
  bool snapshotChanged = publishedSequence != lastSequence;
  if (snapshotChanged) {
    uint32_t coherentSequence = 0;
    if (!ReadGamepadSnapshot(snapshot, coherentSequence)) {
      return;
    }
    lastSequence = coherentSequence;
  } else if (!s_inputNeedsTimedWake.load(std::memory_order_acquire)) {
    // Stationary controllers require no network packet. The timed-wake flag is
    // set only for a held-stick mouse movement or a pending long press.
    return;
  }

  int numGamepads = std::max(0, std::min(kMaxSnapshotPads, snapshot.numGamepads));
  const short activeGamepadMask = GetActiveGamepadMask(snapshot, numGamepads);
  bool pendingLongPress = false;
  bool continuousMouseMovement = false;

  short replacedMask = 0;
  for (int gamepadID = 0; gamepadID < numGamepads; gamepadID++) {
    const short bit = static_cast<short>(1 << gamepadID);
    if ((activeGamepadMask & lastConnectedMask & bit) &&
        snapshot.pads[gamepadID].connectionGeneration != lastConnectionGeneration[gamepadID]) {
      replacedMask |= bit;
    }
  }
  if (activeGamepadMask != lastConnectedMask || replacedMask) {
    for (int gamepadID = 0; gamepadID < kMaxSnapshotPads; gamepadID++) {
      const short bit = static_cast<short>(1 << gamepadID);
      if ((lastConnectedMask & bit) && (!(activeGamepadMask & bit) || (replacedMask & bit))) {
        // The host must free the previous virtual device before its new arrival.
        // Other controllers use independent reliable channels. Keep their bits
        // set so a delayed release cannot retire an already reannounced owner.
        const short retainedMask = activeGamepadMask & ~bit;
        if (LiSendMultiControllerEvent(gamepadID, retainedMask, 0, 0, 0, 0, 0, 0, 0) != 0) continue;
        lastConnectedMask &= ~bit;
        packetValid[gamepadID] = false;
        comboTriggered[gamepadID] = false;
        guideLatched[gamepadID] = false;
        longPressLatched[gamepadID] = false;
        PostToJsAsync("controllerLost: " + std::to_string(gamepadID));
        playPressedAt[gamepadID] = {};
      }
    }
    for (int gamepadID = 0; gamepadID < numGamepads; gamepadID++) {
      const short bit = static_cast<short>(1 << gamepadID);
      if (!(lastConnectedMask & bit) && (activeGamepadMask & bit)) {
        const auto& gamepad = snapshot.pads[gamepadID];
        uint16_t capabilities = static_cast<uint16_t>(gamepad.capabilities);
        if (!rumbleFeedbackSwitch.load(std::memory_order_acquire)) {
          capabilities &= ~LI_CCAP_RUMBLE;
        }
        if (LiSendControllerArrivalEvent(
          gamepadID, activeGamepadMask, static_cast<uint8_t>(gamepad.controllerType),
          static_cast<uint32_t>(gamepad.supportedButtonFlags), capabilities) != 0) continue;
        lastConnectedMask |= bit;
        lastConnectionGeneration[gamepadID] = gamepad.connectionGeneration;
        packetValid[gamepadID] = false;
        PostToJsAsync("controllerFound: " + std::to_string(gamepadID));
      }
    }
  }

  const GamepadTuning tuning = ReadGamepadTuning();

  for (int gamepadID = 0; gamepadID < numGamepads; ++gamepadID) {
    const GamepadState& gamepad = snapshot.pads[gamepadID];
    const short bit = static_cast<short>(1 << gamepadID);
    if (!gamepad.connected || !(lastConnectedMask & bit) ||
        gamepad.connectionGeneration != lastConnectionGeneration[gamepadID]) {
      continue;
    }

    ControllerPacketState packet = {};
    packet.buttonFlags = GetButtonFlags(gamepad);
    float leftX = gamepad.axis[GamepadAxis::LeftX];
    float leftY = gamepad.axis[GamepadAxis::LeftY];
    float rightX = gamepad.axis[GamepadAxis::RightX];
    float rightY = gamepad.axis[GamepadAxis::RightY];
    if (tuning.enabled) {
      if ((tuning.invertLeft & 1) != 0) leftX = -leftX;
      if ((tuning.invertLeft & 2) != 0) leftY = -leftY;
      if ((tuning.invertRight & 1) != 0) rightX = -rightX;
      if ((tuning.invertRight & 2) != 0) rightY = -rightY;
      if (tuning.swapSticks) {
        std::swap(leftX, rightX);
        std::swap(leftY, rightY);
      }
    }
    packet.leftTrigger = static_cast<unsigned char>(std::lround(
      ShapeTrigger(tuning, gamepad.analogButton[GamepadButton::LeftTrigger]) * 255.0f));
    packet.rightTrigger = static_cast<unsigned char>(std::lround(
      ShapeTrigger(tuning, gamepad.analogButton[GamepadButton::RightTrigger]) * 255.0f));
    packet.leftStickX = static_cast<short>(std::lround(
      ShapeAxis(tuning, leftX) * 32767.0f));
    packet.leftStickY = static_cast<short>(std::lround(
      -ShapeAxis(tuning, leftY) * 32767.0f));
    packet.rightStickX = static_cast<short>(std::lround(
      ShapeAxis(tuning, rightX) * 32767.0f));
    packet.rightStickY = static_cast<short>(std::lround(
      -ShapeAxis(tuning, rightY) * 32767.0f));

    const bool suppressed = s_inputSuppressed.load(std::memory_order_acquire);
    if (suppressed) {
      guideLatched[gamepadID] = false;
      // One neutral packet releases held gameplay/mouse input atomically. Later
      // identical packets are suppressed by the existing packetValid path.
      packet = {};
    } else {
      // Guide is normally button 16. Back+Start is a separate fallback, not a
      // replacement for the existing four-button stop and stats combinations.
      // The system gesture is consumed: while it is held the host receives a
      // neutral packet, so the PC does not also open its own overlay or read a
      // partially released fallback as a fresh Start press.
      const bool specialHeld = (packet.buttonFlags & SPECIAL_FLAG) != 0;
      const bool backStartCombo = packet.buttonFlags == (BACK_FLAG | PLAY_FLAG);
      if (!guideLatched[gamepadID] && (specialHeld || backStartCombo)) {
        guideLatched[gamepadID] = true;
        PostToJsAsync("guideButton");
      }
      if (guideLatched[gamepadID]) {
        if (!specialHeld && (packet.buttonFlags & (BACK_FLAG | PLAY_FLAG)) == 0) {
          guideLatched[gamepadID] = false;
        }
        packet = {};
      }
    }

    // Check if the current button flags match the defined button combination on the gamepad
    if (packet.buttonFlags == STOP_STREAM_BUTTONS) {
      // Terminate the connection
      stopStream();
      return;
    } else if (packet.buttonFlags == PERF_STATS_BUTTONS) {
      if (!comboTriggered[gamepadID]) {
        // Toggle performance stats overlay
        toggleStats();
        // Mark combo as triggered until buttons are released
        comboTriggered[gamepadID] = true;
      }
    } else {
      // Reset when buttons are released
      comboTriggered[gamepadID] = false;
    }

    // Check if the mouse emulation switch is checked
    if (mouseEmulationSwitch) {
      const auto currentTime = std::chrono::steady_clock::now();
      if (packet.buttonFlags & PLAY_FLAG) {
        if (playPressedAt[gamepadID].time_since_epoch().count() == 0) {
          playPressedAt[gamepadID] = currentTime;
        }
        const auto durationTime = std::chrono::duration_cast<std::chrono::milliseconds>(
          currentTime - playPressedAt[gamepadID]).count();
        if (durationTime >= 1000 && !longPressLatched[gamepadID]) {
          // Toggle mouse emulation state
          if (!mouseEmulationActive) {
            // Activate mouse emulation and notify the user
            mouseEmulationActive = true;
            PostToJs(std::string("mouseEmulationOn"));
          } else {
            // Deactivate mouse emulation and notify the user
            mouseEmulationActive = false;
            PostToJs(std::string("mouseEmulationOff"));
          }
          longPressLatched[gamepadID] = true;
        }
        if (!longPressLatched[gamepadID]) {
          pendingLongPress = true;
        }
      } else {
        playPressedAt[gamepadID] = {};
        longPressLatched[gamepadID] = false;
      }
    } else {
      // Deactivate mouse emulation if the mouse emulation switch is unchecked
      mouseEmulationActive = false;
    }

    // If mouse emulation is active, then send mouse input to the desired handler (acts as a mouse)
    if (mouseEmulationActive) {
      // Left Stick values are mapped to horizontal and vertical mouse movements
      const float baseMouseSpeed = 10.0f;
      const float leftStickMagnitude = std::sqrt(
        static_cast<float>(packet.leftStickX) * packet.leftStickX +
        static_cast<float>(packet.leftStickY) * packet.leftStickY) / 32767.0f;
      const float mouseSpeed = baseMouseSpeed * leftStickMagnitude;
      const float mouseXDelta = static_cast<float>(packet.leftStickX) / 32767.0f * mouseSpeed;
      const float mouseYDelta = -static_cast<float>(packet.leftStickY) / 32767.0f * mouseSpeed;
      
      // Send a mouse move event with the specified delta values for both horizontal (X-axis) and vertical (Y-axis) coordinates
      LiSendMouseMoveEvent(static_cast<int>(mouseXDelta), static_cast<int>(mouseYDelta));

      // Right Stick values are mapped to horizontal and vertical mouse scrolls
      const float baseScrollSpeed = 1.0f;
      const float rightStickMagnitude = std::sqrt(
        static_cast<float>(packet.rightStickX) * packet.rightStickX +
        static_cast<float>(packet.rightStickY) * packet.rightStickY) / 32767.0f;
      const float scrollSpeed = baseScrollSpeed * rightStickMagnitude;
      const float scrollXDelta = static_cast<float>(packet.rightStickX) / 32767.0f * scrollSpeed;
      const float scrollYDelta = static_cast<float>(packet.rightStickY) / 32767.0f * scrollSpeed;

      continuousMouseMovement = continuousMouseMovement ||
        std::abs(mouseXDelta) >= 1.0f || std::abs(mouseYDelta) >= 1.0f ||
        std::abs(scrollXDelta) >= 1.0f || std::abs(scrollYDelta) >= 1.0f;
      
      // Send mouse scroll events with the specified delta values for both horizontal (X-axis) and vertical (Y-axis) coordinates
      LiSendHScrollEvent(static_cast<int>(scrollXDelta));
      LiSendScrollEvent(static_cast<int>(scrollYDelta));

      // Face Buttons values are mapped to control mouse buttons
      unsigned char newMouseButtonMask = 0;
      if (packet.buttonFlags & (A_FLAG | LB_FLAG)) { newMouseButtonMask |= 1; }
      if (packet.buttonFlags & (X_FLAG | Y_FLAG)) { newMouseButtonMask |= 2; }
      if (packet.buttonFlags & (B_FLAG | RB_FLAG)) { newMouseButtonMask |= 4; }
      static const int mouseButtons[] = {BUTTON_LEFT, BUTTON_MIDDLE, BUTTON_RIGHT};
      for (int button = 0; button < 3; button++) {
        const unsigned char bit = static_cast<unsigned char>(1 << button);
        if ((newMouseButtonMask & bit) != (mouseButtonMask & bit)) {
          LiSendMouseButtonEvent(
            (newMouseButtonMask & bit) ? BUTTON_ACTION_PRESS : BUTTON_ACTION_RELEASE,
            mouseButtons[button]);
        }
      }
      mouseButtonMask = newMouseButtonMask;
    } else {
      if (!packetValid[gamepadID] ||
          std::memcmp(&lastPacket[gamepadID], &packet, sizeof(packet)) != 0) {
        LiSendMultiControllerEvent(
          gamepadID, activeGamepadMask, packet.buttonFlags, packet.leftTrigger,
          packet.rightTrigger, packet.leftStickX, packet.leftStickY,
          packet.rightStickX, packet.rightStickY);
        lastPacket[gamepadID] = packet;
        packetValid[gamepadID] = true;
      }
    }
  }

  // An ordinary stationary controller now sleeps indefinitely. Snapshot and
  // mouse events notify the condition variable immediately, so this removes
  // idle wakeups without adding input latency.
  s_inputNeedsTimedWake.store(
    pendingLongPress || continuousMouseMovement, std::memory_order_release);
}

// Rumble magnitudes, published where the animation frame callback can read them.
//
// The host sends these continuously during action. The path they used to take
// cost far more than the effect is worth: a string built through an
// ostringstream, a **synchronous** crossing to the main thread, the string
// parsed back out, navigator.getGamepads() to find the pad, a concatenated line
// logged to the console, and only then the effect. All of it landed on the
// thread that also schedules every audio frame, and it was measurable as uneven
// video, which is why the feature had to be switched off to get a smooth
// picture.
//
// Nothing crosses now. The magnitudes are written here and platform/gamepad.js
// reads them from its animation frame callback, which is already walking the
// gamepads once per frame. Posting a message per event, even asynchronously,
// would still put one main thread task per event on a stream whose rate we do
// not control; polling a word of memory puts none, whatever the host sends.
//
// Both magnitudes live in one 32-bit word so a single aligned atomic store
// publishes them together. Split across two words, a reader could catch a new
// low against an old high; packed, that cannot happen and no sequence counter is
// needed to prove it.
static std::atomic<int32_t> s_rumblePacked[kMaxSnapshotPads];

static inline int32_t PackRumble(uint16_t lowFreqMotor, uint16_t highFreqMotor) {
  return (int32_t)(((uint32_t)lowFreqMotor << 16) | (uint32_t)highFreqMotor);
}

// Handed to JS once, when the input loop starts.
extern "C" EMSCRIPTEN_KEEPALIVE void* rumbleStateAddress() {
  return &s_rumblePacked[0];
}

// Forwards a rumble event from the host to the gamepad.
void MoonlightInstance::ClControllerRumble(unsigned short controllerNumber, unsigned short lowFreqMotor, unsigned short highFreqMotor) {
  if (!rumbleFeedbackSwitch || controllerNumber >= kMaxSnapshotPads) {
    return;
  }

  const int32_t packed = PackRumble(lowFreqMotor, highFreqMotor);

  // A repeat of the magnitudes already in force changes nothing on the pad.
  // Games hold a constant vibration for long stretches, so this is most of them.
  if (s_rumblePacked[controllerNumber].load(std::memory_order_relaxed) == packed) {
    return;
  }
  s_rumblePacked[controllerNumber].store(packed, std::memory_order_release);
}

// Clears the published magnitudes so a new stream starts from silence rather
// than from whatever the last one left behind.
extern "C" EMSCRIPTEN_KEEPALIVE void resetRumbleState() {
  for (int i = 0; i < kMaxSnapshotPads; i++) {
    s_rumblePacked[i].store(0, std::memory_order_release);
  }
}

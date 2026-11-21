'use strict';
// Scenarios run in the same VM scope as wasm/fixtures/gamepad-snapshot-prelude.js.
const fs = require('fs'), vm = require('vm');
const prelude = fs.readFileSync('wasm/fixtures/gamepad-snapshot-prelude.js', 'utf8');
vm.runInNewContext(prelude + '\n(' + scenarios + ')();', {require, console});
function scenarios() {
  // A physical index hole is compacted to logical controller zero.
  assert.strictEqual(context.getStreamingGamepadMask(), 1);
  context.startGamepadSnapshot(true);
  assert(rafCallback);
  rafCallback();
  assert.strictEqual(notifications, 1);
  const base = snapshotPtr >> 2;
  assert.strictEqual(Atomics.load(heap32, base) & 1, 0);
  assert.strictEqual(Atomics.load(heap32, base + 1), 4);
  assert.strictEqual(Atomics.load(heap32, base + 2), 1);
  assert.strictEqual(Atomics.load(heap32, base + 2 + 4), 2); // PlayStation type

  // An unchanged frame performs no shared publication and no worker wakeup.
  rafCallback();
  assert.strictEqual(notifications, 1);

  pad.buttons[0] = { value: 1, pressed: true };
  pad.timestamp++;
  rafCallback();
  assert.strictEqual(notifications, 2);

  // Physical haptics run after rAF and host bursts coalesce at a 10 Hz ceiling.
  const rumbleBase = rumblePtr >> 2;
  Atomics.store(heap32, rumbleBase, (0x7000 << 16) | 0x3000);
  rafCallback();
  assert.strictEqual(rumbleCalls.length, 0);
  assert(timerCallback);
  let pendingTimer = timerCallback;
  timerCallback = null;
  pendingTimer();
  assert.strictEqual(rumbleCalls.length, 1);
  assert.strictEqual(rumbleCalls[0].type, 'dual-rumble');

  now = 20;
  Atomics.store(heap32, rumbleBase, (0x4000 << 16) | 0x2000);
  rafCallback();
  assert.strictEqual(timerCallback, null);
  now = 120;
  rafCallback();
  assert(timerCallback);
  pendingTimer = timerCallback;
  timerCallback = null;
  pendingTimer();
  assert.strictEqual(rumbleCalls.length, 2);

  // If the platform retains preempted Promises, calls are bounded rather than
  // accumulating forever. The latest state remains pending and the watchdog
  // eventually lets it through without disturbing the input animation frame.
  now = 220;
  Atomics.store(heap32, rumbleBase, (0x3000 << 16) | 0x1000);
  rafCallback();
  assert(timerCallback);
  pendingTimer = timerCallback;
  timerCallback = null;
  pendingTimer();
  assert.strictEqual(rumbleCalls.length, 2);

  now = 900;
  rafCallback();
  assert(timerCallback);
  pendingTimer = timerCallback;
  timerCallback = null;
  pendingTimer();
  assert.strictEqual(rumbleCalls.length, 3);

  // Zero always preempts, even while an actuator operation is outstanding.
  now = 910;
  Atomics.store(heap32, rumbleBase, 0);
  rafCallback();
  assert(timerCallback);
  pendingTimer = timerCallback;
  timerCallback = null;
  pendingTimer();
  assert.strictEqual(rumbleCalls[3].type, 'reset');

  context.stopGamepadSnapshot();
  assert.strictEqual(Atomics.load(heap32, base + 1), 0);

  // With haptics disabled at the protocol boundary, the animation frame does not
  // even scan the rumble mailboxes or schedule a post-frame task.
  const callsBeforeDisabledRun = rumbleCalls.length;
  context.startGamepadSnapshot(false);
  Atomics.store(heap32, rumbleBase, (0x7000 << 16) | 0x3000);
  rafCallback();
  assert.strictEqual(timerCallback, null);
  assert.strictEqual(rumbleCalls.length, callsBeforeDisabledRun);
  context.stopGamepadSnapshot();
  console.log('gamepad_snapshot_test: ok');
}

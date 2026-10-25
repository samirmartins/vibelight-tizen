#include "frame_pacing.hpp"
#include <cassert>
#include <atomic>
#include <iostream>
#include <limits>
#include <thread>
#include <vector>

namespace mlvideo {
struct FramePacerTestAccess {
  static bool IsWaiting(FramePacer& pacer) {
    std::lock_guard<std::mutex> lock(pacer.mutex_);
    return pacer.schedule_.Active();
  }
};
}

extern "C" {
void fixture_reset(int); void fixture_deliver(int, int); void fixture_close();
void fixture_cancel(); void fixture_set_time(uint64_t); void fixture_service(uint64_t);
unsigned fixture_requests(); int fixture_idr_processed();
void paced_fixture_start(PACED_VIDEO_QUEUE_NOTIFY, void*);
void paced_fixture_large(unsigned);
void paced_fixture_fail_holder();
void requestDecoderRefresh();
void stopVideoDepacketizer();
}

static uint64_t digest;
static unsigned submissions;
extern "C" int fixture_submit(PDECODE_UNIT du) {
  const auto word = [](uint64_t x) { digest ^= x; digest *= 1099511628211ull; };
  word(du->frameNumber); word(du->frameType); word(du->presentationTimeMs);
  word(du->enqueueTimeMs); word(du->fullLength);
  unsigned length = 0;
  for (auto p = du->bufferList; p; p = p->next) {
    word(p->bufferType); word(p->length); length += p->length;
    for (int i = 0; i < p->length; ++i) word(static_cast<unsigned char>(p->data[i]));
  }
  assert(length == static_cast<unsigned>(du->fullLength));
  submissions++;
  return DR_OK;
}

struct Observer {
  std::mutex mutex;
  PACED_VIDEO_QUEUE_STATE state{};
  mlvideo::FramePacer* pacer = nullptr;
  static void Changed(void* context, const PACED_VIDEO_QUEUE_STATE* next) {
    auto& self = *static_cast<Observer*>(context);
    if (self.pacer) mlvideo::FramePacer::QueueChanged(self.pacer, next);
    std::lock_guard<std::mutex> lock(self.mutex);
    self.state = *next;
  }
  PACED_VIDEO_QUEUE_STATE Read() { std::lock_guard<std::mutex> lock(mutex); return state; }
};
static void Close() { fixture_cancel(); fixture_close(); }
static VIDEO_FRAME_HANDLE Take(PDECODE_UNIT& du) {
  VIDEO_FRAME_HANDLE handle;
  assert(LiPollNextVideoFrame(&handle, &du));
  assert(LiPacedVideoFrameIsCurrent(du));
  return handle;
}

static void ScheduleContracts() {
  constexpr double t = 1e6 / 60;
  // The real producer timestamp is quantized to milliseconds. A stable source
  // and ordinary rounding must not activate waiting.
  for (double rate : {24., 30., 50., 59.94, 60., 60.1, 120.}) {
    mlvideo::PacingSchedule schedule;
    for (uint32_t i = 0; i < 12000; ++i) {
      uint64_t arrival = 10000 + static_cast<uint64_t>(i * 1000 / rate);
      assert(schedule.Deadline(i, arrival, 1e6 / rate) == arrival * 1000.);
      assert(!schedule.Active());
    }
  }
  mlvideo::PacingSchedule jitter;
  unsigned waits = 0;
  for (uint32_t i = 0; i < 2000; ++i) {
    const uint64_t arrival = 10000 + static_cast<uint64_t>(i * t / 1000 + (i % 2 ? 2 : 0));
    const auto deadline = jitter.Deadline(i, arrival, t);
    assert(deadline >= arrival * 1000. && deadline <= arrival * 1000. + t / 2 + 1e-6);
    if (i < 32) assert(deadline == arrival * 1000.);
    waits += deadline > arrival * 1000.;
  }
  assert(waits > 1000);
  // Qualified phase follows the already generated PTS, without resetting to
  // half a frame ahead after each late packet or spending that whole budget.
  mlvideo::PacingSchedule phase;
  double holdSum = 0, previous = 0, maxError = 0;
  unsigned measured = 0;
  for (uint32_t i = 0; i < 2400; ++i) {
    const auto a = 10000 + static_cast<uint64_t>(i * t / 1000 + (i % 2 ? 2 : 0));
    const auto d = phase.Deadline(i, a, t, i * t);
    assert(d >= a * 1000. && d - a * 1000. <= t / 2 + 1e-6);
    if (i > 128) {
      holdSum += d - a * 1000.; ++measured;
      maxError = std::max(maxError, std::abs((d - previous) - t));
    }
    previous = d;
  }
  assert(holdSum / measured < 4000 && maxError < 1000);
  // The existing PTS can jump after recovery. Never wait using its old phase.
  assert(phase.Deadline(2400, 50000, t, 1) == 50000000.);
  assert(phase.Deadline(2401, 50017, t, 0) == 50017000.);
  assert(phase.Deadline(2402, 50033, t,
    std::numeric_limits<double>::quiet_NaN()) >= 50033000.);
  // The legacy timer protection stays cumulative and session-scoped.
  mlvideo::PacingSchedule timer;
  for (int i = 0; i < 64; ++i) timer.NoteWake(500);
  assert(!timer.Bypassed());
  for (int i = 0; i < 15; ++i) timer.NoteWake(4000);
  assert(!timer.Bypassed());
  timer.NoteWake(4000); assert(timer.Bypassed());
  jitter.NoteWake(2000);
  for (int i = 0; i < 14; ++i) jitter.NoteWake(2000);
  assert(!jitter.Bypassed()); jitter.NoteWake(2000); assert(jitter.Bypassed());
  jitter.Reanchor();
  for (uint32_t i = 2000; i < 2100; ++i) {
    const auto a = 10000 + static_cast<uint64_t>(i * t / 1000 + (i % 2 ? 2 : 0));
    assert(jitter.Deadline(i, a, t) == a * 1000.);
  }
  mlvideo::PacingSchedule discontinuity;
  assert(discontinuity.Deadline(1, 0, t) == 0);
  assert(discontinuity.Deadline(2, 20000, t) == 20000000);
  assert(discontinuity.Deadline(200, 20017, t) == 20017000);
  assert(discontinuity.Deadline(201, 19000, t) == 19000000);
  // Slightly faster sources never accumulate a minimum-spacing backlog.
  mlvideo::PacingSchedule drift;
  for (uint32_t i = 0; i < 12000; ++i) {
    auto a = 10000 + static_cast<uint64_t>(i * 1000 / 60.1 + (i % 2 ? 2 : 0));
    auto d = drift.Deadline(i, a, t);
    assert(d - a * 1000. <= t / 2 + 1e-6);
  }
}

static void TransportContracts() {
  for (int codec : {VIDEO_FORMAT_H264, VIDEO_FORMAT_H265, VIDEO_FORMAT_AV1_MAIN8}) {
    for (int fragments : {1, 3}) {
      fixture_reset(codec); digest = 0; submissions = 0;
      for (int i = 0; i < 101; ++i) fixture_deliver(i == 0, fragments);
      const auto expected = digest; assert(submissions == 101); Close();
      fixture_reset(codec); Observer observer; paced_fixture_start(Observer::Changed, &observer);
      digest = 0; submissions = 0;
      for (int i = 0; i < 101; ++i) {
        fixture_deliver(i == 0, fragments);
        assert(observer.Read().frames == 1);
        PDECODE_UNIT du; auto h = Take(du);
        assert(observer.Read().frames == 0 && observer.Read().bytes == 0);
        fixture_submit(du); LiCompleteVideoFrame(h, DR_OK);
      }
      assert(digest == expected && submissions == 101); Close();
    }
  }
  fixture_reset(VIDEO_FORMAT_H265); Observer o; paced_fixture_start(Observer::Changed, &o);
  PDECODE_UNIT du; VIDEO_FRAME_HANDLE h;
  // Arrival and dequeue must not acknowledge IDR success.
  fixture_deliver(1, 3); assert(!fixture_idr_processed()); h = Take(du);
  assert(!fixture_idr_processed()); LiCompleteVideoFrame(h, DR_NEED_IDR);
  assert(fixture_requests() == 1 && o.Read().recovering);
  for (int i = 0; i < 10; ++i) {
    fixture_deliver(1, 3); h = Take(du); LiCompleteVideoFrame(h, DR_NEED_IDR);
  }
  assert(fixture_requests() == 1);
  fixture_service(10499); assert(fixture_requests() == 1);
  fixture_service(10500); assert(fixture_requests() == 2);
  fixture_deliver(1, 3); h = Take(du);
  fixture_deliver(0, 3); assert(!LiPollNextVideoFrame(&h, &du));
  // Recovery can invalidate a frame currently owned by the worker.
  LiRequestPacedVideoRefresh(); assert(!LiPacedVideoFrameIsCurrent(du));
  LiCompleteVideoFrame(h, DR_OK); assert(!fixture_idr_processed());
  fixture_deliver(1, 3); h = Take(du); LiCompleteVideoFrame(h, DR_OK);
  assert(fixture_idr_processed() && !o.Read().recovering);
  // Native 15-entry overflow explicitly flushes and enters IDR recovery.
  for (int i = 0; i < 16; ++i) fixture_deliver(0, 3);
  assert(o.Read().frames == 0 && o.Read().bytes == 0 && o.Read().recovering);
  fixture_deliver(1, 3); h = Take(du); LiCompleteVideoFrame(h, DR_OK);
  // Large valid frames are admitted. The byte limit is only a hold budget.
  paced_fixture_large(16 * 1024 * 1024 + 1);
  assert(o.Read().bytes == 16 * 1024 * 1024 + 1);
  h = Take(du); assert(du->fullLength == 16 * 1024 * 1024 + 1);
  LiCompleteVideoFrame(h, DR_OK); Close();

  fixture_reset(VIDEO_FORMAT_H265); Observer allocation;
  paced_fixture_start(Observer::Changed, &allocation);
  paced_fixture_fail_holder(); fixture_deliver(1, 3);
  assert(allocation.Read().frames == 0 && allocation.Read().recovering);
  assert(!fixture_idr_processed() && fixture_requests() == 1);
  fixture_deliver(1, 3); h = Take(du); LiCompleteVideoFrame(h, DR_OK); Close();

  for (uint64_t now : {0ull, (1ull << 32) - 200}) {
    fixture_reset(VIDEO_FORMAT_H265); Observer wrap;
    paced_fixture_start(Observer::Changed, &wrap);
    fixture_set_time(now); LiRequestPacedVideoRefresh();
    LiRequestPacedVideoRefresh(); assert(fixture_requests() == 1);
    fixture_service(now + 499); assert(fixture_requests() == 1);
    fixture_service(now + 500); assert(fixture_requests() == 2);
    LiRequestPacedVideoRefresh(); fixture_cancel(); fixture_service(now + 1000);
    assert(fixture_requests() == 2); fixture_close();
  }

  // Shutdown wakes an empty consumer; joining precedes freeing queue/context.
  for (int cycle = 0; cycle < 100; ++cycle) {
    fixture_reset(VIDEO_FORMAT_AV1_MAIN8); Observer observer;
    paced_fixture_start(Observer::Changed, &observer);
    std::atomic<bool> entered{false}, done{false};
    std::thread consumer([&] {
      VIDEO_FRAME_HANDLE handle; PDECODE_UNIT unit; entered = true;
      assert(!LiWaitForNextVideoFrame(&handle, &unit)); done = true;
    });
    while (!entered.load()) std::this_thread::yield();
    fixture_cancel(); consumer.join(); assert(done); fixture_close();
  }

  for (int codec : {VIDEO_FORMAT_H264, VIDEO_FORMAT_H265, VIDEO_FORMAT_AV1_MAIN8}) {
    fixture_reset(codec); Observer observer; paced_fixture_start(Observer::Changed, &observer);
    std::atomic<unsigned> consumed{0};
    std::thread decoder([&] {
      VIDEO_FRAME_HANDLE handle; PDECODE_UNIT unit;
      while (LiWaitForNextVideoFrame(&handle, &unit)) {
        fixture_submit(unit);
        LiCompleteVideoFrame(handle, unit->frameNumber % 19 == 0 ? DR_NEED_IDR : DR_OK);
        consumed++;
      }
    });
    fixture_deliver(1, 3);
    while (!consumed.load()) std::this_thread::yield();
    for (int i = 0; i < 1200; ++i) {
      fixture_deliver(i % 9 == 0, 3);
      if (i % 4 == 0) std::this_thread::yield();
    }
    // Set the synchronized transport stop before joining. The common fixture's
    // global interrupted flag need not be written concurrently with recovery.
    stopVideoDepacketizer(); decoder.join();
    assert(consumed > 1); Close();
  }
}

static void WaitContracts() {
  using Clock = std::chrono::steady_clock;
  // Exercise a real condition wait, with earlier observation samples mapped
  // into the past. A larger synthetic frame period makes wake tests independent
  // of sub-millisecond desktop scheduling; TV timer precision is not measured.
  for (int reason = 0; reason < 3; ++reason) {
    mlvideo::FramePacer waiting(10000, Clock::now() - std::chrono::milliseconds(6400));
    PACED_VIDEO_QUEUE_STATE state{}; state.epoch = 1;
    mlvideo::FramePacer::QueueChanged(&waiting, &state);
    for (uint32_t i = 0; i < 32; ++i)
      assert(waiting.Wait(i, 10000 + i * 200 + (i % 2 ? 20 : 0), 100, 200000, false));
    std::atomic<bool> entered{false}; bool result = false;
    auto started = Clock::now();
    std::thread worker([&] { entered = true; result = waiting.Wait(32, 16400, 100, 200000, false); });
    while (!entered.load()) std::this_thread::yield();
    while (!mlvideo::FramePacerTestAccess::IsWaiting(waiting)) std::this_thread::yield();
    if (reason == 0) { state.frames = 1; mlvideo::FramePacer::QueueChanged(&waiting, &state); }
    else if (reason == 1) { state.epoch++; mlvideo::FramePacer::QueueChanged(&waiting, &state); }
    else waiting.Stop();
    worker.join();
    assert(result == (reason == 0));
    assert(Clock::now() - started < std::chrono::milliseconds(90));
  }
  // All guard paths must be interruptible without a new receive packet.
  mlvideo::FramePacer pacer(10000);
  PACED_VIDEO_QUEUE_STATE state{}; state.epoch = 1;
  mlvideo::FramePacer::QueueChanged(&pacer, &state);
  assert(pacer.Wait(1, 10000, 1024, 1e6 / 60, true));
  state.frames = 1;
  mlvideo::FramePacer::QueueChanged(&pacer, &state);
  assert(pacer.Wait(2, 10017, 1024, 1e6 / 60, false));
  state.frames = 0; mlvideo::FramePacer::QueueChanged(&pacer, &state);
  assert(pacer.Wait(3, 10033, 16 * 1024 * 1024 + 1, 1e6 / 60, false));
  assert(pacer.Wait(4, UINT64_MAX - 100, 1, 1e6 / 60, false));
  pacer.Stop(); assert(!pacer.Wait(4, 10050, 1, 1e6 / 60, false));
}

int main() {
  ScheduleContracts();
  std::cout << "frame_pacing: quantized rates, PTS phase, jitter, budget, drift and timer bypass PASS\n";
  TransportContracts();
  std::cout << "frame_pacing: real three-codec RTP/direct equality, IDR ACK/cooldown, epochs, FIFO/oversized/overflow and 100 shutdowns PASS\n";
  WaitContracts();
  std::cout << "frame_pacing: actual condition wake by backlog/recovery/stop and wait guard paths PASS\n";
}

#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <VideoPacing.h>

namespace mlvideo {

// Submission deadlines, not presentation deadlines. All arithmetic below is
// reads the existing PTS timeline and producer's millisecond stamp. It never
// changes packet timestamps or implements a second PTS servo.
class PacingSchedule {
  static constexpr unsigned kWindow = 32;
  static constexpr double kStampUs = 1000;
  bool anchored_ = false;
  bool active_ = false;
  bool bypass_ = false;
  uint32_t frame_ = 0;
  double arrival_ = 0;
  double phase_ = 0;
  double pts_ = -1;
  double roughness_ = 0;
  unsigned samples_ = 0;
  unsigned lateWakes_ = 0;
  double low_ = 0, high_ = 0, previousHigh_ = 0;
  unsigned windowSamples_ = 0, roughSamples_ = 0;
  bool envelope_ = false;

  double PhaseCorrection(double periodUs) const {
    // Overlapping windows reject sub-ms stamp rounding. The half-frame
    // bound still wins when the observed arrival spread exceeds that budget.
    return std::min(std::max(high_, previousHigh_) + kStampUs,
                    low_ + periodUs / 2);
  }
public:
  void Reanchor() {
    anchored_ = active_ = false;
    samples_ = 0;
    roughness_ = 0;
    pts_ = -1;
    low_ = high_ = previousHigh_ = 0;
    windowSamples_ = roughSamples_ = 0;
    envelope_ = false;
    // A bad timer remains bypassed until the entire session is replaced.
  }
  bool Bypassed() const { return bypass_; }
  bool Active() const { return active_; }
  void NoteWake(double lateUs) {
    if (lateUs > 1000 && ++lateWakes_ >= 16) bypass_ = true;
  }
  double Deadline(uint32_t frame, uint64_t enqueueMs, double periodUs,
                  double ptsUs = -1) {
    const double arrival = static_cast<double>(enqueueMs) * 1000;
    const uint32_t advance = frame - frame_;
    const bool hasPts = std::isfinite(ptsUs) && ptsUs >= 0;
    const double step = hasPts && pts_ >= 0 ? ptsUs - pts_ : advance * periodUs;
    if (!enqueueMs || !std::isfinite(periodUs) || periodUs <= 0) {
      Reanchor(); return arrival;
    }
    if (!anchored_ || !advance || advance > 8 || arrival <= arrival_ ||
        step <= 0 || std::abs(step - advance * periodUs) > periodUs / 2 ||
        std::abs((arrival - arrival_) - advance * periodUs) > 2 * periodUs) {
      Reanchor(); anchored_ = true;
      frame_ = frame; arrival_ = arrival; phase_ = arrival;
      pts_ = hasPts ? ptsUs : -1;
      return arrival;
    }
    const double error = std::abs((arrival - arrival_) / advance - periodUs);
    roughness_ += (error - roughness_) / 32;
    samples_++;
    phase_ += step;
    pts_ = hasPts ? ptsUs : -1;
    frame_ = frame; arrival_ = arrival;
    const double residual = arrival - phase_;
    if (!windowSamples_) low_ = high_ = residual;
    else { low_ = std::min(low_, residual); high_ = std::max(high_, residual); }
    windowSamples_++;
    roughSamples_ += error > kStampUs;
    if (bypass_) return arrival;
    if (!active_) {
      if (samples_ < kWindow || roughness_ <= kStampUs) {
        if (windowSamples_ >= kWindow) {
          previousHigh_ = high_; windowSamples_ = roughSamples_ = 0;
        }
        return arrival;
      }
      active_ = true;
      // Repeated jitter can share a stable PTS-relative phase instead of
      // restarting half a frame ahead whenever one packet is late. Sparse
      // outliers or very wide bursts retain the previous conservative policy.
      envelope_ = roughSamples_ >= kWindow / 4 && high_ - low_ <= periodUs * .75;
      const double correction = envelope_ ? PhaseCorrection(periodUs)
                                         : arrival + periodUs / 2 - phase_;
      phase_ += correction;
      previousHigh_ = high_ - correction;
      windowSamples_ = roughSamples_ = 0;
    } else if (windowSamples_ >= kWindow) {
      const double candidate = PhaseCorrection(periodUs);
      const double correction = envelope_ && std::abs(candidate) > kStampUs
        ? std::max(-kStampUs / 4, std::min(kStampUs / 4, candidate)) : 0;
      phase_ += correction;
      previousHigh_ = high_ - correction;
      windowSamples_ = roughSamples_ = 0;
    }
    if (phase_ < arrival) {
      // Late frames are always sent now. With a qualified phase, do not make
      // a single late packet shift every subsequent deadline by half a frame.
      if (!envelope_) phase_ = arrival + periodUs / 2;
      return arrival;
    }
    return std::min(phase_, arrival + periodUs / 2);
  }
};

class FramePacer {
  friend struct FramePacerTestAccess;
  using Clock = std::chrono::steady_clock;
  using Microseconds = std::chrono::microseconds;
  static constexpr uint64_t kSoftBytes = 16ull * 1024 * 1024;
  std::mutex mutex_;
  std::condition_variable changed_;
  PACED_VIDEO_QUEUE_STATE queue_{};
  PacingSchedule schedule_;
  uint64_t epoch_ = 0;
  const uint64_t originMs_;
  const Clock::time_point origin_;
  bool stopped_ = false;
public:
  explicit FramePacer(uint64_t nowMs, Clock::time_point origin = Clock::now())
    : originMs_(nowMs), origin_(origin) {}
  static void QueueChanged(void* context, const PACED_VIDEO_QUEUE_STATE* state) {
    auto& pacer = *static_cast<FramePacer*>(context);
    std::lock_guard<std::mutex> lock(pacer.mutex_);
    pacer.queue_ = *state;
    pacer.changed_.notify_all();
  }
  void Stop() {
    std::lock_guard<std::mutex> lock(mutex_);
    stopped_ = true;
    changed_.notify_all();
  }
  bool Wait(uint32_t frame, uint64_t enqueueMs, uint64_t bytes,
            double periodUs, bool keyframe, double ptsUs = -1) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (stopped_ || queue_.stopped) return false;
    const auto epoch = queue_.epoch;
    if (epoch_ != epoch || keyframe) { schedule_.Reanchor(); epoch_ = epoch; }
    if (!enqueueMs) { schedule_.Reanchor(); return true; }
    const double deadlineUs = schedule_.Deadline(frame, enqueueMs, periodUs, ptsUs);
    // Include the frame owned by this worker. Oversized valid frames bypass
    // waiting; they are not rejected or trimmed to fit this soft budget.
    if (queue_.frames || bytes > kSoftBytes || queue_.bytes > kSoftBytes - bytes ||
        queue_.recovering || keyframe) { schedule_.Reanchor(); return true; }
    if (!std::isfinite(deadlineUs) || deadlineUs <= enqueueMs * 1000.0) return true;
    const double offsetUs = deadlineUs - static_cast<double>(originMs_) * 1000;
    const double clockLimit = std::chrono::duration<double, std::micro>(Clock::duration::max()).count() / 4;
    if (std::abs(offsetUs) > clockLimit || periodUs / 2 > clockLimit) {
      schedule_.Reanchor(); return true;
    }
    const auto now = Clock::now();
    // Producer stamps are quantized. Their clock mapping may differ by a
    // fraction of a millisecond: cap the actual requested wait as well.
    const auto deadline = std::min(
      origin_ + Microseconds(static_cast<int64_t>(offsetUs)),
      now + Microseconds(static_cast<int64_t>(periodUs / 2)));
    if (now >= deadline) return true;
    const bool interrupted = changed_.wait_until(lock, deadline, [&] {
      return stopped_ || queue_.stopped || queue_.epoch != epoch ||
             queue_.frames || queue_.recovering;
    });
    if (interrupted) schedule_.Reanchor();
    else schedule_.NoteWake(std::chrono::duration<double, std::micro>(
      Clock::now() - deadline).count());
    return !stopped_ && !queue_.stopped && queue_.epoch == epoch;
  }
};

} // namespace mlvideo

#pragma once

#include "Limelight.h"

#ifdef __cplusplus
extern "C" {
#endif

// Private queued-renderer extension. Configure during setup, before workers
// start; destroyVideoDepacketizer retires it only after those workers join.
typedef struct _PACED_VIDEO_QUEUE_STATE {
    unsigned frames;
    uint64_t bytes;
    uint64_t oldestEnqueueMs;
    uint64_t epoch;
    bool recovering;
    bool stopped;
} PACED_VIDEO_QUEUE_STATE;

// Notification runs under the transport lock. It must not call common-c,
// submit packets, proxy the UI, or wait for another thread.
typedef void (*PACED_VIDEO_QUEUE_NOTIFY)(void*, const PACED_VIDEO_QUEUE_STATE*);
int LiConfigurePacedVideoQueue(PACED_VIDEO_QUEUE_NOTIFY notify, void* context);
bool LiPacedVideoFrameIsCurrent(PDECODE_UNIT decodeUnit);
// Use after a platform flush, so queued/owned references from before that
// flush cannot acknowledge recovery or feed dependent frames afterward.
void LiRequestPacedVideoRefresh(void);

#ifdef __cplusplus
}
#endif

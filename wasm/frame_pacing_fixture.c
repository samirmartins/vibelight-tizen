// Test-only adapter: real RTP, depacketizer, queue and platform synchronization.
// The common fixture provides synthetic packet contents and a controlled clock.
#include "Limelight-internal.h"
static size_t failHolderSize;
static void* paced_test_malloc(size_t size);
#define malloc paced_test_malloc
#define REAL_VIDEO_QUEUE
#include "video_recovery_fixture.c"
#undef malloc
#include "VideoPacing.h"

static void* paced_test_malloc(size_t size) {
    if (failHolderSize && size == failHolderSize) { failHolderSize = 0; return NULL; }
    return malloc(size);
}

void paced_fixture_fail_holder(void) { failHolderSize = sizeof(PACED_DECODE_UNIT); }

void paced_fixture_start(PACED_VIDEO_QUEUE_NOTIFY notify, void* context) {
    VideoCallbacks.capabilities &= ~CAPABILITY_DIRECT_SUBMIT;
    assert(LiConfigurePacedVideoQueue(notify, context) == 0);
}

void paced_fixture_large(unsigned bytes) {
    assert(nalChainHead == NULL);
    PLENTRY_INTERNAL entry = malloc(sizeof(*entry) + bytes);
    assert(entry);
    entry->allocPtr = entry;
    entry->entry.next = NULL;
    entry->entry.data = (char*)(entry + 1);
    memset(entry->entry.data, 0x55, bytes);
    entry->entry.length = bytes;
    entry->entry.bufferType = BUFFER_TYPE_PICDATA;
    nalChainHead = nalChainTail = &entry->entry;
    nalChainDataLength = bytes;
    frameType = FRAME_TYPE_PFRAME;
    PltLockMutex(&pacedQueue->mutex);
    reassembleFrame(nextFrame++);
    PltUnlockMutex(&pacedQueue->mutex);
}

/* Windows stand-in for nod-ffi's header. The Rust nod library is not part of the Windows
 * build yet, so GameCube/Wii container formats (RVZ, WIA, GCZ, CISO, WBFS) report an invalid
 * container while plain ISO/GCM images still hash directly. */
#ifndef AC_NOD_STUB_H
#define AC_NOD_STUB_H

#include <stddef.h>
#include <stdint.h>

typedef struct NodHandle NodHandle;
typedef enum NodResult { NOD_RESULT_OK = 0, NOD_RESULT_ERR_UNSUPPORTED = 1 } NodResult;

static inline NodResult nod_disc_open(const char* path, const void* options, NodHandle** out) {
  (void)path;
  (void)options;
  *out = NULL;
  return NOD_RESULT_ERR_UNSUPPORTED;
}

static inline int64_t nod_seek(NodHandle* handle, int64_t offset, int origin) {
  (void)handle;
  (void)offset;
  (void)origin;
  return -1;
}

static inline int64_t nod_read(NodHandle* handle, uint8_t* buffer, size_t length) {
  (void)handle;
  (void)buffer;
  (void)length;
  return -1;
}

static inline void nod_free(NodHandle* handle) {
  (void)handle;
}

#endif

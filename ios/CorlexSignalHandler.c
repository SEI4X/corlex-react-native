#include "CorlexSignalHandler.h"
#include "CorlexCrashCore/include/CorlexRNCrash.h"
#include <stdio.h>
#include <string.h>

#define CORLEX_PATH_MAX 1024
#define CORLEX_HEADER_MAX 1024

static int valid_uuid(const char *uuid) {
  if (uuid == NULL || strnlen(uuid, 37) != 36) return 0;
  for (int i = 0; i < 36; i++) {
    char c = uuid[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return 0;
    } else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return 0;
  }
  return 1;
}

int corlex_signal_install_with_header(const char *directory, const char *crash_id, const char *header) {
  if (!valid_uuid(crash_id) || directory == NULL || header == NULL) return 0;
  if (strnlen(directory, CORLEX_PATH_MAX) >= CORLEX_PATH_MAX ||
      strnlen(header, CORLEX_HEADER_MAX) >= CORLEX_HEADER_MAX) return 0;
  char path[CORLEX_PATH_MAX];
  int count = snprintf(path, sizeof(path), "%s/crash-%s.corlex", directory, crash_id);
  if (count < 0 || (size_t)count >= sizeof(path)) return 0;
  return corlex_rn_crash_install(path, header);
}

int corlex_signal_install(const char *directory, const char *crash_id) {
  if (!valid_uuid(crash_id)) return 0;
  char header[128];
  int count = snprintf(header, sizeof(header), "{\"v\":1,\"crash_id\":\"%s\",\"kind\":\"native\",\"fatal\":true,", crash_id);
  if (count < 0 || (size_t)count >= sizeof(header)) return 0;
  return corlex_signal_install_with_header(directory, crash_id, header);
}

void corlex_signal_set_enabled(int enabled) { corlex_rn_crash_set_enabled(enabled); }

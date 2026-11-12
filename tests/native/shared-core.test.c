// Both SDKs link together without duplicate public symbols. No fatal signal is raised.
#include "CorlexRNCrash.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifdef CORLEX_TEST_COEXISTENCE
extern int corlex_crash_install(const char *, const char *);
extern void corlex_crash_set_enabled(int);
#endif

__attribute__((noinline)) int corlex_release_fixture(int number) { return number * 7 + 3; }

int main(int argc, char **argv) {
  assert(argc == 2);
  #ifdef CORLEX_TEST_COEXISTENCE
  char sibling[1024];
  assert(snprintf(sibling, sizeof(sibling), "%s.sibling", argv[1]) > 0);
  assert(corlex_crash_install(sibling, "{\"kind\":\"native\",") == 1);
  corlex_crash_set_enabled(0);
  #endif
  assert(corlex_rn_crash_install(argv[1], "{\"crash_id\":\"01234567-89ab-4cde-8fab-0123456789ab\",\"kind\":\"native\",\"platform\":\"ios\",\"app_version\":\"1.2.3\",\"build\":\"42\",") == 1);
  corlex_rn_crash_set_enabled(0);
  assert(corlex_rn_crash_open_report() < 0);
  char rearmed[1024];
  snprintf(rearmed, sizeof(rearmed), "%s.rearmed", argv[1]);
  assert(corlex_rn_crash_install(rearmed, "{\"generation\":\"fresh\",") == 1);
  corlex_rn_crash_set_enabled(0);
  assert(corlex_rn_crash_install(argv[1], "{\"crash_id\":\"01234567-89ab-4cde-8fab-0123456789ab\",\"kind\":\"native\",\"platform\":\"ios\",\"app_version\":\"1.2.3\",\"build\":\"42\",") == 1);
  int fd = corlex_rn_crash_open_report();
  assert(fd >= 0);
  corlex_rn_crash_write_header(fd, "ns_exception", "NativeError", "Error details omitted");
  uintptr_t frames[] = {(uintptr_t)&corlex_release_fixture};
  corlex_rn_crash_write_frames(fd, frames, 1, 0);
  close(fd);
  corlex_rn_crash_set_enabled(0);
  assert(corlex_rn_crash_install(rearmed, "{\"generation\":\"fresh\",") == 0);
  assert(access(rearmed, F_OK) != 0); // no second fatal capture in the same lifetime
  assert(corlex_release_fixture(2) == 17);
  puts("Namespaced native core report passed");
  return 0;
}

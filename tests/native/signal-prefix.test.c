// Exercise the actual C translation unit under ASan/UBSan. No signal is raised and no app runs.
#include "../../ios/CorlexSignalHandler.c"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static char recorded_path[1024];
static char recorded_header[1024];
static int calls = 0;
int corlex_rn_crash_install(const char *path, const char *header) {
  calls++;
  assert(strlen(path) < sizeof(recorded_path));
  assert(strlen(header) < sizeof(recorded_header));
  strcpy(recorded_path, path);
  strcpy(recorded_header, header);
  return 1;
}
void corlex_rn_crash_set_enabled(int enabled) { (void)enabled; }

int main(void) {
  const char *uuid = "01234567-89ab-4cde-8fab-0123456789ab";
  char directory[] = "/tmp/corlex-signal-test.XXXXXX";
  assert(mkdtemp(directory) != NULL);
  assert(corlex_signal_install(directory, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") == 0);
  assert(corlex_signal_install(directory, "01234567-89ab-4cde-8fab-0123456789abx") == 0);
  assert(corlex_signal_install(directory, "01234567-89ab-4cde-8fab-0123456789a") == 0);
  assert(corlex_signal_install(directory, "01234567-89ab-4cde-8fab-0123456789a/") == 0);
  assert(corlex_signal_install(directory, "01234567-89ab-4cde-8fab-0123456789a\"") == 0);
  assert(corlex_signal_install(NULL, uuid) == 0);
  assert(corlex_signal_install(directory, NULL) == 0);
  char long_path[CORLEX_PATH_MAX + 1];
  memset(long_path, 'a', sizeof(long_path) - 1);
  long_path[sizeof(long_path) - 1] = '\0';
  assert(corlex_signal_install(long_path, uuid) == 0);
  assert(calls == 0);
  assert(corlex_signal_install(directory, uuid) == 1);
  assert(calls == 1);
  assert(strstr(recorded_header, uuid) != NULL);
  assert(strstr(recorded_path, uuid) != NULL);
  char long_header[1025];
  memset(long_header, 'a', sizeof(long_header) - 1);
  long_header[sizeof(long_header) - 1] = '\0';
  assert(corlex_signal_install_with_header(directory, uuid, long_header) == 0);
  assert(calls == 1);
  rmdir(directory);
  puts("Signal prefix bounds and normal UUID report passed");
  return 0;
}

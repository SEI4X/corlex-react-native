#ifndef CORLEX_SIGNAL_HANDLER_H
#define CORLEX_SIGNAL_HANDLER_H

#ifdef __cplusplus
extern "C" {
#endif

/// Installs handlers for fatal signals (SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGTRAP).
///
/// On a signal the handler writes `<directory>/crash-<crash_id>.corlex` (one JSON header line,
/// then bounded structured frames with Mach-O UUID and addresses) and then calls the handler that was installed
/// before, or, if there was none, lets the default action kill the process. Only async-signal-safe
/// calls are made after the signal arrives; everything else is prepared here.
///
/// `directory` must exist. `crash_id` is a 36-character hexadecimal UUID chosen for this process: a process crashes once.
/// Returns 1 when the handlers are installed (also when they already were), 0 on failure.
int corlex_signal_install(const char *directory, const char *crash_id);

/// The same bounded installation with a JSON prefix prepared outside the fatal signal context.
int corlex_signal_install_with_header(const char *directory, const char *crash_id, const char *header);

/// While disabled the handlers only pass the signal on (no file is written).
void corlex_signal_set_enabled(int enabled);

#ifdef __cplusplus
}
#endif

#endif

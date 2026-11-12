import Foundation

/// Only nonblocking alternate-stack preparation hops to main; protected state/report IO stays off it.
enum CorlexMainThread {
  static func prepareCrashStack() -> Bool {
    if Thread.isMainThread { return corlex_rn_crash_prepare_thread_stack() == 1 }
    return DispatchQueue.main.sync { corlex_rn_crash_prepare_thread_stack() == 1 }
  }
}

import Foundation

final class Result: @unchecked Sendable {
  private let lock = NSLock(); private var value = false
  func set(_ value: Bool) { lock.lock(); self.value = value; lock.unlock() }
  func get() -> Bool { lock.lock(); defer { lock.unlock() }; return value }
}
var before = sigaction(), after = sigaction()
precondition(sigaction(SIGSEGV, nil, &before) == 0)
let result = Result(), done = DispatchSemaphore(value:0)
DispatchQueue.global().async {
  var workerBefore = stack_t(), workerAfter = stack_t()
  guard sigaltstack(nil, &workerBefore) == 0, CorlexMainThread.prepareCrashStack(),
    sigaltstack(nil, &workerAfter) == 0 else { done.signal(); return }
  result.set(workerBefore.ss_flags == workerAfter.ss_flags && workerBefore.ss_sp == workerAfter.ss_sp)
  done.signal()
}
let deadline = Date(timeIntervalSinceNow:10)
var finished = false
while Date() < deadline {
  if done.wait(timeout:.now()) == .success { finished = true; break }
  _ = RunLoop.main.run(mode:.default, before:Date(timeIntervalSinceNow:0.01))
}
precondition(finished && result.get(), "worker installed stack instead of preparing main")
var mainStack = stack_t()
precondition(sigaltstack(nil, &mainStack) == 0 && (mainStack.ss_flags & SS_DISABLE) == 0)
precondition(corlex_rn_crash_open_report() == -1, "pending preparation armed capture")
precondition(sigaction(SIGSEGV, nil, &after) == 0 && before.sa_flags == after.sa_flags)
print("Actual worker-to-main bridge preparation: main altstack ready, worker unchanged, pending capture disabled passed")

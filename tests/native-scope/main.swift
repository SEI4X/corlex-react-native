import Foundation
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let state = CorlexStateStore(directory: root)
let owner = String(repeating: "a", count: 64), other = String(repeating: "b", count: 64)
let generation = UUID().uuidString.lowercased()
func command(_ input: [String: Any]) throws -> String { try CorlexStateCodec.encoded(input) }
func select(_ owner: String, _ generation: String) throws -> URL {
  try state.selectScope(owner, generation) { CorlexCrashReporter.shared.uninstall() }
  let installed = try state.withScope(owner, generation) { CorlexCrashReporter.shared.install(directory: $0) }
  precondition(installed)
  return try state.withScope(owner, generation) { $0 }
}
func record(_ owner: String, _ generation: String) throws {
  try state.withScope(owner, generation) {
    CorlexCrashReporter.shared.recordJs("{\"kind\":\"js\",\"message\":\"synthetic\"}", directory: $0)
  }
}
let grant = try command(["generation":generation,"state":"granted","sdkChoice":"granted"])
_ = try state.exchange(command(["expected":"","owner":owner,"privacy":grant]))
let directoryA = try select(owner, generation)
try record(owner, generation)
let files = try FileManager.default.contentsOfDirectory(at: directoryA, includingPropertiesForKeys: nil)
precondition(files.count == 1, "native reporter wrote outside admitted owner scope")
let directoryB = try select(other, generation)
do { try record(owner, generation); fatalError("stale tuple wrote into selected B") } catch { }
CorlexCrashReporter.shared.recordJs("{}", directory: directoryA)
let pendingB = try state.withScope(other, generation) { CorlexCrashReporter.shared.takePending(directory: $0) }
precondition(pendingB.isEmpty, "B recovered A crash")
_ = try select(owner, generation)
let pendingA = try state.withScope(owner, generation) { CorlexCrashReporter.shared.takePending(directory: $0) }
precondition(pendingA.count == 1 && pendingA[0].contains("synthetic"))
// A queued operation must not escape a newly published refusal or revive its old directory.
let denial = try command(["generation":UUID().uuidString.lowercased(),"state":"denied","sdkChoice":"denied"])
try state.revoke(denial, expected: grant) { CorlexCrashReporter.shared.uninstall() }
do { try record(owner, generation); fatalError("revoked tuple admitted") } catch { }
precondition(!FileManager.default.fileExists(atPath: directoryA.path))
precondition(!FileManager.default.fileExists(atPath: directoryB.path))
// Fresh generation re-arms shared C while disabled; an exception is recorded without raising it.
let freshGeneration = UUID().uuidString.lowercased()
let fresh = try command(["generation":freshGeneration,"state":"granted","sdkChoice":"granted"])
_ = try state.exchange(command(["expected":denial,"owner":other,"privacy":fresh,"explicitChoice":"granted"]))
let freshDirectory = try select(other, freshGeneration)
let exception = NSException(name: NSExceptionName("person@example.test"), reason: "private-token", userInfo: nil)
NSGetUncaughtExceptionHandler()?(exception)
let native = try state.withScope(other, freshGeneration) { CorlexCrashReporter.shared.takePending(directory: $0) }
precondition(native.count == 1 && native[0].contains("Error details omitted"))
precondition(!native[0].contains("person@example.test") && !native[0].contains("private-token"))
precondition(native[0].contains(other) && native[0].contains(freshGeneration))
let flags = try freshDirectory.resourceValues(forKeys: [.isExcludedFromBackupKey])
precondition(flags.isExcludedFromBackup == true)
print("Scoped reporter: private path, owner isolation, immutable tuple, withdrawal, rearm, native default privacy passed")

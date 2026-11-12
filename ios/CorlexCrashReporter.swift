import Foundation

/// Native crash capture for iOS: an NSException handler and, in C, fatal-signal handlers. Each
/// writes one file in its admitted backup-excluded owner/generation scope; the JS side reads and deletes the
/// files at the next launch. A file is one JSON header line followed by stack frames.
///
/// Both chain to whatever handler was installed before (Sentry, Firebase, Expo's own), so
/// installing this next to another crash reporter changes nothing for that reporter.
final class CorlexCrashReporter {
  static let shared = CorlexCrashReporter()

  private static let maxFiles = 20

  private let lock = NSLock()
  private var installed = false
  private var captureErrorMessages = false
  private(set) var enabled = false
  private var crashId = ""
  private var directory: URL?
  fileprivate var previousExceptionHandler: (@convention(c) (NSException) -> Void)?

  /// Installs the handlers once per process; calling again only re-enables them.
  func install(directory dir: URL, captureErrorMessages: Bool = false) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    self.captureErrorMessages = captureErrorMessages
    if enabled && directory == dir { return true }
    enabled = false
    corlex_signal_set_enabled(0)
    directory = dir
    crashId = UUID().uuidString.lowercased()
    guard CorlexNativeWriter.install(directory: dir, crashId: crashId) else { return false }
    if !installed {
      previousExceptionHandler = NSGetUncaughtExceptionHandler()
      NSSetUncaughtExceptionHandler { exception in
        CorlexCrashReporter.shared.writeException(exception)
        CorlexCrashReporter.shared.previousExceptionHandler?(exception)
      }
      installed = true
    }
    enabled = true
    return true
  }

  /// Stop capture before the state owner publishes refusal and removes scoped files.
  func uninstall() {
    corlex_signal_set_enabled(0)
    lock.lock()
    defer { lock.unlock() }
    enabled = false
    corlex_signal_set_enabled(0)
  }

  /// Crash files of earlier launches, oldest first; they are deleted as they are taken.
  func takePending(directory dir: URL) -> [String] {
    lock.lock(); defer { lock.unlock() }
    let files = crashFiles(in: dir).sorted { $0.lastPathComponent < $1.lastPathComponent }
    var texts: [String] = []
    for (index, file) in files.enumerated() {
      defer { try? FileManager.default.removeItem(at: file) }
      guard index >= files.count - Self.maxFiles,
        let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
        size <= 256 * 1024,
        let text = Self.readBounded(file), Self.matchesScope(text, directory: dir)
      else { continue }
      texts.append(text)
    }
    return texts
  }

  /// A JS crash, written at once: the process ends right after a fatal JS error.
  func recordJs(_ json: String, directory dir: URL) {
    lock.lock(); defer { lock.unlock() }
    guard enabled, directory == dir, json.utf8.count <= 256 * 1024,
      var report = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
      else { return }
    report["binding_owner"] = dir.deletingLastPathComponent().lastPathComponent
    report["binding_generation"] = dir.lastPathComponent
    guard let json = try? CorlexStateCodec.encoded(report), json.utf8.count <= 256 * 1024 else { return }
    let file = dir.appendingPathComponent("js-\(UUID().uuidString.lowercased()).corlex")
    guard let data = (json + "\n").data(using: .utf8) else { return }
    #if os(iOS) || os(tvOS)
    try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    #else
    try? data.write(to: file, options: .atomic)
    #endif
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
  }

  fileprivate func writeException(_ exception: NSException) {
    lock.lock(); defer { lock.unlock() }
    guard enabled else { return }
    CorlexNativeWriter.writeException(exception, captureErrorMessages: captureErrorMessages)
  }

  /// For checking the setup end to end. The crash happens on the main queue, after the call returns.
  func crashForTesting(_ kind: String) {
    DispatchQueue.main.async {
      if kind == "signal" {
        raise(SIGSEGV)
      } else {
        NSException(
          name: NSExceptionName("CorlexTestException"),
          reason: "Deliberate native crash from the Corlex example",
          userInfo: nil
        ).raise()
      }
    }
  }

  private func crashFiles() -> [URL] {
    guard let dir = directory else { return [] }
    return crashFiles(in: dir)
  }

  private func crashFiles(in dir: URL) -> [URL] {
    let all = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
    return all.filter { $0.pathExtension == "corlex" }
  }

  private static func readBounded(_ file: URL) -> String? {
    guard let handle = try? FileHandle(forReadingFrom: file) else { return nil }
    defer { try? handle.close() }
    guard let data = try? handle.read(upToCount: 256 * 1024 + 1), data.count <= 256 * 1024
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func matchesScope(_ text: String, directory: URL) -> Bool {
    guard let line = text.split(separator: "\n").first,
      let header = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
      else { return false }
    return header["binding_owner"] as? String == directory.deletingLastPathComponent().lastPathComponent &&
      header["binding_generation"] as? String == directory.lastPathComponent
  }
}

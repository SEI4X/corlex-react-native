import Foundation

/// All allocation and JSON escaping happens outside the fatal-signal handler.
/// The namespaced C core records image UUID/base/address frames for both native paths.
enum CorlexNativeWriter {
  static func install(directory: URL, crashId: String) -> Bool {
    let bundle = Bundle.main
    var fields: [String: Any] = [
      "v": 1, "crash_id": crashId, "kind": "native", "fatal": true, "platform": "ios",
      "arch": architecture,
      "app_version": metadata(bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", maxBytes: 128),
      "build": metadata(bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "", maxBytes: 32),
    ]
    let owner = directory.deletingLastPathComponent().lastPathComponent
    if CorlexStateCodec.ownerValid(owner), UUID(uuidString: directory.lastPathComponent) != nil {
      fields["binding_owner"] = owner
      fields["binding_generation"] = directory.lastPathComponent
    }
    guard let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
      var header = String(data: data, encoding: .utf8)
    else { return false }
    header.removeLast()
    header += ","
    return corlex_signal_install_with_header(directory.path, crashId, header) == 1
  }

  static func writeException(_ exception: NSException, captureErrorMessages: Bool) {
    let fd = corlex_rn_crash_open_report()
    guard fd >= 0 else { return }
    defer { close(fd) }
    let message = captureErrorMessages ? String((exception.reason ?? "").prefix(512)) : "Error details omitted"
    corlex_rn_crash_write_header(fd, "ns_exception", "NativeError", escaped(message))
    let addresses = exception.callStackReturnAddresses.prefix(100).map { $0.uintValue }
    addresses.withUnsafeBufferPointer { frames in
      corlex_rn_crash_write_frames(fd, frames.baseAddress, Int32(frames.count), 1)
    }
  }

  static func metadata(_ value: String, maxBytes: Int) -> String {
    value.utf8.count <= maxBytes ? value : ""
  }

  private static func escaped(_ value: String) -> String {
    guard let data = try? JSONEncoder().encode(value), let json = String(data: data, encoding: .utf8)
    else { return "" }
    return String(json.dropFirst().dropLast())
  }

  private static var architecture: String {
    #if arch(arm64)
    return "arm64"
    #elseif arch(x86_64)
    return "x86_64"
    #else
    return "unknown"
    #endif
  }
}

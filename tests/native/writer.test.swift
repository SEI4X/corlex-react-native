import Foundation

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let detailed = CommandLine.arguments[2] == "detailed"
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
let id = "01234567-89ab-4cde-8fab-0123456789ab"
precondition(CorlexNativeWriter.install(directory: directory, crashId: id))
// Construct and record an exception normally. Never raise it or run/crash a user application.
let exception = NSException(name: NSExceptionName("customer@example.test"), reason: "secret-token-123\"\\n", userInfo: nil)
CorlexNativeWriter.writeException(exception, captureErrorMessages: detailed)
let file = directory.appendingPathComponent("crash-\(id).corlex")
let text = try String(contentsOf: file, encoding: .utf8)
let header = try JSONSerialization.jsonObject(with: Data(text.split(separator: "\n")[0].utf8)) as! [String: Any]
precondition(header["platform"] as? String == "ios")
precondition(header["name"] as? String == "NativeError")
precondition(header["app_version"] as? String != nil && header["build"] as? String != nil)
precondition(!text.contains("customer@example.test"))
if detailed { precondition(header["message"] as? String == exception.reason) }
else { precondition(header["message"] as? String == "Error details omitted" && !text.contains("secret-token")) }
let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
precondition((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
print("Native writer privacy, metadata and mode passed")

precondition(CorlexNativeWriter.metadata(String(repeating: "9", count: 32), maxBytes: 32).count == 32)
precondition(CorlexNativeWriter.metadata(String(repeating: "9", count: 33), maxBytes: 32).isEmpty)
precondition(CorlexNativeWriter.metadata(String(repeating: "a", count: 125) + "😀", maxBytes: 128).isEmpty)

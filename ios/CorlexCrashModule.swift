import AppTrackingTransparency
import ExpoModulesCore

/// The JS-facing side of native crash capture (see CorlexCrashReporter) and a read-only look at the
/// App Tracking Transparency status. The module never shows the ATT prompt, never reads the
/// advertising identifier, and adds no permission or usage description to the app.
public class CorlexCrashModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CorlexCrash")

    AsyncFunction("readSdkState") { () throws -> String in
      try CorlexStateStore.shared.read()
    }
    AsyncFunction("writeSdkState") { (json: String) throws in
      try CorlexStateStore.shared.write(json)
    }

    AsyncFunction("readBoundSdkState") { (owner: String) throws -> String in
      try CorlexStateStore.shared.readBound(owner)
    }
    AsyncFunction("exchangeSdkState") { (command: String) throws -> String in
      try CorlexStateStore.shared.exchange(command) { CorlexCrashReporter.shared.uninstall() }
    }
    Function("currentSdkPrivacy") { () throws -> String in
      try CorlexStateStore.shared.currentPrivacy()
    }
    Function("revokeSdkPrivacy") { (expected: String, record: String) throws -> String in
      try CorlexStateStore.shared.revoke(record, expected: expected) { CorlexCrashReporter.shared.uninstall() }
    }
    Function("observeSdkCeiling") { (expected: String, ceiling: String) throws -> String in
      try CorlexStateStore.shared.observe(expected, ceiling: ceiling) { CorlexCrashReporter.shared.uninstall() }
    }
    Function("selectSdkScope") { (owner: String, generation: String) throws in
      try CorlexStateStore.shared.selectScope(owner, generation) { CorlexCrashReporter.shared.uninstall() }
    }

    Function("sdkCapabilities") { ["crashPrivacy": 1, "protectedStorage": 2, "crashBinding": 1] }

    Function("install") { (captureErrorMessages: Bool, owner: String, generation: String) throws -> Bool in
      guard CorlexMainThread.prepareCrashStack() else { return false }
      return try CorlexStateStore.shared.scoped(owner, generation, CorlexScopeOperation(run: { directory in
        CorlexCrashReporter.shared.install(directory: directory, captureErrorMessages: captureErrorMessages)
      }, invalidated: { CorlexCrashReporter.shared.uninstall() }))
    }

    Function("uninstall") {
      CorlexCrashReporter.shared.uninstall()
    }

    AsyncFunction("takePendingCrashes") { (owner: String, generation: String) throws -> [String] in
      try CorlexStateStore.shared.scoped(owner, generation, CorlexScopeOperation(
        run: { CorlexCrashReporter.shared.takePending(directory: $0) }, invalidated: { CorlexCrashReporter.shared.uninstall() }))
    }

    Function("recordJsCrash") { (json: String, owner: String, generation: String) throws in
      try CorlexStateStore.shared.scoped(owner, generation, CorlexScopeOperation(
        run: { CorlexCrashReporter.shared.recordJs(json, directory: $0) }, invalidated: { CorlexCrashReporter.shared.uninstall() }))
    }

    Function("trackingStatus") { () -> String in
      switch ATTrackingManager.trackingAuthorizationStatus {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .restricted: return "restricted"
      case .notDetermined: return "notDetermined"
      @unknown default: return "notDetermined"
      }
    }

    Function("crashForTesting") { (kind: String) in
      CorlexCrashReporter.shared.crashForTesting(kind)
    }
  }
}

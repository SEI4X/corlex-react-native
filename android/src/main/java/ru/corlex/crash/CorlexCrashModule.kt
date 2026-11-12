package ru.corlex.crash

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS-facing side of native crash capture (see [CorlexCrashReporter]). Android has no App
 * Tracking Transparency, so [trackingStatus] says `unsupported`; the module never reads the
 * advertising id.
 */
class CorlexCrashModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val state by lazy { CorlexStateStore(context) }

  override fun definition() = ModuleDefinition {
    Name("CorlexCrash")

    AsyncFunction("readSdkState") { -> state.read() }

    AsyncFunction("writeSdkState") { json: String -> state.write(json) }

    AsyncFunction("readBoundSdkState") { owner: String -> state.readBound(owner) }
    AsyncFunction("exchangeSdkState") { command: String -> state.exchange(command) { CorlexCrashReporter.uninstall() } }
    Function("currentSdkPrivacy") { -> state.currentPrivacy() }
    Function("revokeSdkPrivacy") { expected: String, record: String ->
      state.revoke(record, expected) { CorlexCrashReporter.uninstall() }
    }
    Function("observeSdkCeiling") { expected: String, ceiling: String ->
      state.observe(expected, ceiling) { CorlexCrashReporter.uninstall() }
    }
    Function("selectSdkScope") { owner: String, generation: String -> state.selectScope(owner, generation) { CorlexCrashReporter.uninstall() } }

    Function("sdkCapabilities") { -> mapOf("crashPrivacy" to 1, "protectedStorage" to 2, "crashBinding" to 1) }

    Function("install") { captureErrorMessages: Boolean, owner: String, generation: String ->
      state.scoped(owner, generation, CorlexScopeOperation({ CorlexCrashReporter.install(context, it, captureErrorMessages) }) { CorlexCrashReporter.uninstall() })
    }

    Function("uninstall") { -> CorlexCrashReporter.uninstall() }

    AsyncFunction("takePendingCrashes") { owner: String, generation: String ->
      state.scoped(owner, generation, CorlexScopeOperation({ directory -> CorlexCrashReporter.takePending(directory) }) { CorlexCrashReporter.uninstall() })
    }

    Function("recordJsCrash") { json: String, owner: String, generation: String ->
      state.scoped(owner, generation, CorlexScopeOperation({ directory -> CorlexCrashReporter.recordJs(json, directory) }) { CorlexCrashReporter.uninstall() })
    }

    Function("trackingStatus") { -> "unsupported" }

    Function("crashForTesting") { _: String -> CorlexCrashReporter.crashForTesting() }
  }
}

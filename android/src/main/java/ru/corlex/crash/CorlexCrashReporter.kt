package ru.corlex.crash

import android.content.Context
import android.os.Process
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * Native crash capture for Android: a default uncaught-exception handler that writes one file per
 * crash in the admitted backup-excluded owner/generation directory, then calls the handler that was installed before (Crashlytics,
 * Sentry, the Android runtime's own), so installing it next to another reporter changes nothing
 * for that one. The JS side reads and deletes the files at the next launch. A file is one JSON
 * header line followed by stack frames, the same shape as on iOS.
 */
object CorlexCrashReporter {
  private const val MAX_MESSAGE = 512
  private const val MAX_FRAMES = 100
  private const val MAX_FILES = 20
  private const val MAX_FILE_BYTES = 256 * 1024
  private var captureErrorMessages = false
  private var appVersion = "unknown"
  private var build = "unknown"

  @Volatile private var enabled = false
  private var installed = false
  private var directory: File? = null
  private val crashId: String = UUID.randomUUID().toString()

  /** Installs the handler once per process; calling again only re-enables it. */
  @Synchronized
  fun install(context: Context, dir: File, captureErrorMessages: Boolean = false): Boolean {
    this.captureErrorMessages = captureErrorMessages
    if (enabled && directory == dir) return true
    enabled = false
    if (!dir.exists() && !dir.mkdirs()) return false
    directory = dir
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    appVersion = metadata(info.versionName ?: "", 128)
    build = if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode.toString() else @Suppress("DEPRECATION") info.versionCode.toString()
    if (!installed) {
      val previous = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { thread, error ->
        try {
          if (enabled) writeCrash(error)
        } catch (_: Throwable) {
          // A failing crash reporter must never replace the crash it was reporting.
        }
        if (previous != null) {
          previous.uncaughtException(thread, error)
        } else {
          Process.killProcess(Process.myPid())
        }
      }
      installed = true
    }
    enabled = true
    return true
  }

  /** Stop capture; the state owner publishes refusal and removes scoped files. */
  fun uninstall() {
    enabled = false
  }

  /** Crash files of earlier launches, oldest first; they are deleted as they are taken. */
  @Synchronized
  fun takePending(dir: File): List<String> {
    val files = dir.listFiles { f -> f.extension == "corlex" }?.sortedBy { it.name } ?: return emptyList()
    val texts = ArrayList<String>()
    files.forEachIndexed { index, file ->
      try {
        if (index >= files.size - MAX_FILES && file.length() <= MAX_FILE_BYTES) readBounded(file)?.let { if (matchesScope(it, dir)) texts.add(it) }
      } finally {
        file.delete()
      }
    }
    return texts
  }

  /** A JS crash, written at once: the process ends right after a fatal JS error. */
  @Synchronized
  fun recordJs(json: String, dir: File) {
    if (!enabled || directory != dir || json.toByteArray(Charsets.UTF_8).size > MAX_FILE_BYTES) return
    val report = try { JSONObject(json) } catch (_: Exception) { return }
    report.put("binding_owner", dir.parentFile!!.name).put("binding_generation", dir.name)
    val payload = report.toString()
    if (payload.toByteArray(Charsets.UTF_8).size > MAX_FILE_BYTES) return
    File(dir, "js-${UUID.randomUUID()}.corlex").writeText(payload + "\n")
  }

  @Synchronized
  private fun writeCrash(error: Throwable) {
    if (!enabled) return
    val dir = directory ?: return
    val file = File(dir, "crash-$crashId.corlex")
    if (file.exists()) return
    val header = JSONObject()
      .put("v", 1)
      .put("crash_id", crashId)
      .put("kind", "native")
      .put("fatal", true)
      .put("source", "java_exception")
      .put("name", safeType(error.javaClass.name))
      .put("message", if (captureErrorMessages) (error.message ?: "").take(MAX_MESSAGE) else "Error details omitted")
      .put("platform", "android")
      .put("app_version", appVersion)
      .put("build", build)
      .put("binding_owner", dir.parentFile!!.name)
      .put("binding_generation", dir.name)
      .put("timestamp_ms", System.currentTimeMillis())
      .put("frames", frames(error))
    file.writeText(header.toString() + "\n")
  }

  private fun metadata(value: String, maxBytes: Int): String {
    if (value.toByteArray(Charsets.UTF_8).size > maxBytes) return ""
    var index = 0
    while (index < value.length) {
      val ch = value[index]
      if (Character.isHighSurrogate(ch)) {
        if (index + 1 >= value.length || !Character.isLowSurrogate(value[index + 1])) return ""
        index++
      } else if (Character.isLowSurrogate(ch)) return ""
      index++
    }
    return value
  }

  private fun safeType(name: String): String =
    if (name.length <= 128 && Regex("[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*").matches(name)) name else "NativeError"

  private fun frames(error: Throwable): JSONArray {
    val frames = JSONArray()
    var current: Throwable? = error
    var depth = 0
    while (current != null && depth < 5 && frames.length() < MAX_FRAMES) {
      current.stackTrace.take(MAX_FRAMES - frames.length()).forEach { element ->
        safeFrame(element)?.let { frames.put(it) }
      }
      current = current.cause
      depth++
    }
    return frames
  }

  private fun safeFrame(element: StackTraceElement): JSONObject? {
    val name = element.className; val method = element.methodName
    if (name.length > 128 || !Regex("[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*").matches(name) ||
      method.length > 64 || !Regex("[A-Za-z_$][A-Za-z0-9_$]*|<init>|<clinit>").matches(method)) return null
    val frame = JSONObject().put("fn", "$name.$method")
    val file = element.fileName?.substringBefore('?')?.substringBefore('#')
      ?.substringAfterLast('/')?.substringAfterLast('\\')
    if (file != null && file.length <= 128 && Regex("[A-Za-z0-9_$.-]+").matches(file)) frame.put("file", file)
    if (element.lineNumber > 0) frame.put("line", element.lineNumber)
    return frame
  }

  private fun readBounded(file: File): String? = file.inputStream().use { input ->
    val bytes = ByteArray(MAX_FILE_BYTES + 1)
    var count = 0
    while (count < bytes.size) {
      val next = input.read(bytes, count, bytes.size - count)
      if (next < 0) break
      count += next
    }
    if (count > MAX_FILE_BYTES) null else String(bytes, 0, count, Charsets.UTF_8)
  }

  private fun matchesScope(text: String, dir: File): Boolean = try {
    val header = JSONObject(text.lineSequence().first())
    header.opt("binding_owner") == dir.parentFile!!.name && header.opt("binding_generation") == dir.name
  } catch (_: Exception) { false }

  /** For checking the setup end to end: the crash happens on the main thread, after the call returns. */
  fun crashForTesting() {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      throw RuntimeException("Deliberate native crash from the Corlex example")
    }
  }
}

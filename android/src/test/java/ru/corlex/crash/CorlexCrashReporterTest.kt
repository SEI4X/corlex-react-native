package ru.corlex.crash

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class CorlexCrashReporterTest {
  @Test fun `native reports preserve retrace metadata without private messages or backups`() {
    val context = RuntimeEnvironment.getApplication()
    val dir = File(context.noBackupFilesDir, "corlex-sdk/scopes/${"a".repeat(64)}/00000000-0000-4000-8000-000000000000")
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    try {
      assertTrue(CorlexCrashReporter.install(context, dir))
      val metadata = CorlexCrashReporter.javaClass.getDeclaredMethod("metadata", String::class.java, Int::class.javaPrimitiveType).apply { isAccessible = true }
      assertEquals("9".repeat(32), metadata.invoke(CorlexCrashReporter, "9".repeat(32), 32))
      assertEquals("", metadata.invoke(CorlexCrashReporter, "9".repeat(33), 32))
      assertEquals("", metadata.invoke(CorlexCrashReporter, "a".repeat(125) + "😀", 128))
      assertEquals("", metadata.invoke(CorlexCrashReporter, "\uD800", 128))
      val write = CorlexCrashReporter.javaClass.getDeclaredMethod("writeCrash", Throwable::class.java).apply { isAccessible = true }
      val error = IllegalStateException("customer@example.test secret-token")
      error.stackTrace = arrayOf(
        StackTraceElement("a.b.C", "a", "/private/SourceFile?token=secret-token", 5),
        StackTraceElement("customer@example.test", "private-token", "private@example.test", 3))
      // Normal method call; never invoke an uncaught handler or crash an application.
      write.invoke(CorlexCrashReporter, error)
      val raw = CorlexCrashReporter.takePending(dir).single()
      assertFalse(raw.contains("customer@example.test"))
      assertFalse(raw.contains("secret-token"))
      assertFalse(raw.contains("/private/"))
      val header = JSONObject(raw)
      assertEquals("android", header.getString("platform"))
      assertEquals("java.lang.IllegalStateException", header.getString("name"))
      assertEquals("Error details omitted", header.getString("message"))
      assertTrue(header.has("app_version") && header.has("build") && header.has("timestamp_ms"))
      val frame = header.getJSONArray("frames").getJSONObject(0)
      assertEquals("a.b.C.a", frame.getString("fn"))
      assertEquals("SourceFile", frame.getString("file"))
      assertEquals(5, frame.getInt("line"))
      assertTrue(dir.isDirectory)
      assertFalse(File(context.filesDir, "corlex-crashes").exists())
      assertTrue(CorlexCrashReporter.install(context, dir, captureErrorMessages = true))
      write.invoke(CorlexCrashReporter, error)
      assertTrue(CorlexCrashReporter.takePending(dir).single().contains("secret-token"))
      CorlexCrashReporter.recordJs("x".repeat(256 * 1024 + 1), dir)
      assertTrue(CorlexCrashReporter.takePending(dir).isEmpty())
    } finally {
      CorlexCrashReporter.uninstall()
      Thread.setDefaultUncaughtExceptionHandler(previous)
    }
  }
  @Test fun `immutable tuple prevents delayed crash writes crossing selected owners`() {
    val context = RuntimeEnvironment.getApplication()
    val state = CorlexStateStore(context)
    val owner = "a".repeat(64); val other = "b".repeat(64)
    val generation = java.util.UUID.randomUUID().toString()
    val record = JSONObject().put("generation", generation).put("state", "granted").put("sdkChoice", "granted").toString()
    state.exchange(JSONObject().put("expected", "").put("owner", owner).put("privacy", record).toString())
    fun select(owner: String): File {
      state.selectScope(owner, generation) { CorlexCrashReporter.uninstall() }
      return state.withScope(owner, generation) {
        assertTrue(CorlexCrashReporter.install(context, it)); it
      }
    }
    try {
      val directoryA = select(owner)
      state.withScope(owner, generation) { CorlexCrashReporter.recordJs("{\"kind\":\"js\"}", it) }
      assertEquals(1, directoryA.listFiles()!!.size)
      val directoryB = select(other)
      try {
        state.withScope(owner, generation) { CorlexCrashReporter.recordJs("{}", it) }
        fail("stale tuple admitted")
      } catch (_: IllegalArgumentException) { }
      CorlexCrashReporter.recordJs("{}", directoryA)
      assertTrue(state.withScope(other, generation) { CorlexCrashReporter.takePending(it) }.isEmpty())
      select(owner)
      assertEquals(1, state.withScope(owner, generation) { CorlexCrashReporter.takePending(it) }.size)
      val denial = JSONObject().put("generation", java.util.UUID.randomUUID().toString())
        .put("state", "denied").put("sdkChoice", "denied").toString()
      state.revoke(denial, record) { CorlexCrashReporter.uninstall() }
      assertFalse(directoryA.exists()); assertFalse(directoryB.exists())
      try { state.withScope(owner, generation) { fail("revoked scope admitted") }; fail("denial bypassed") } catch (_: IllegalArgumentException) { }
    } finally { CorlexCrashReporter.uninstall() }
  }
}

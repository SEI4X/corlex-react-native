package ru.corlex.crash

import android.content.Context
import android.util.AtomicFile
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import org.json.JSONObject


/** One aggregate SDK state budget; privacy is published before stale namespaces are removed. */
internal class CorlexStateStore(context: Context) {
  private val directory = rootDirectory(context)
  private val fenceKey = directory.absolutePath
  private val file = AtomicFile(File(directory, "state.json"))
  private val privacyFile = AtomicFile(File(directory, "privacy.json"))

  private fun <T> locked(block: () -> T): T = synchronized(mutex) {
    require(directory.isDirectory || directory.mkdirs()) { "state_directory_unavailable" }
    RandomAccessFile(File(directory, ".state.lock"), "rw").use { lock ->
      lock.channel.lock().use { block() }
    }
  }
  fun read(): String = locked {
    require(privacyText().isEmpty()) { "state_bound" }
    val serial = CorlexProcessPrivacy.lease(fenceKey, "") ?: throw IllegalStateException("privacy_changed")
    val result = readState()
    require(CorlexProcessPrivacy.valid(fenceKey, serial)) { "privacy_changed" }
    result
  }
  fun write(text: String) = locked {
    require(privacyText().isEmpty()) { "state_bound" }
    writeState(text)
  }
  private fun readFile(target: AtomicFile, max: Int, missing: String): String {
    val input = try { target.openRead() } catch (_: java.io.FileNotFoundException) { return missing }
    val bytes = input.use {
      val output = ByteArrayOutputStream()
      val buffer = ByteArray(8192)
      while (true) {
        val count = it.read(buffer)
        if (count < 0) break
        require(output.size() + count <= max) { "state_budget_exceeded" }
        output.write(buffer, 0, count)
      }
      output.toByteArray()
    }
    return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
  }
  private fun readState(): String = readFile(file, CorlexStateCodec.MAX_BYTES, "{}").also { CorlexStateCodec.validate(it) }
  private fun writeState(text: String) { CorlexStateCodec.validate(text); writeFile(file, text) }
  private fun writeFile(target: AtomicFile, text: String) {
    val stream = target.startWrite()
    try { stream.write(text.toByteArray(Charsets.UTF_8)); target.finishWrite(stream) }
    catch (failure: Throwable) { target.failWrite(stream); throw failure }
  }
  fun currentPrivacy(): String = CorlexProcessPrivacy.floor(fenceKey) ?: locked { privacyText() }
  private fun privacyText(): String = CorlexProcessPrivacy.floor(fenceKey) ?: CorlexProcessPrivacy.read(fenceKey, privacyDisk())
  private fun privacyDisk(): String = readFile(privacyFile, 256, "").also {
    if (it.isNotEmpty()) CorlexStateCodec.privacy(it)
  }
  fun readBound(owner: String? = null): String {
    require(owner == null || CorlexStateCodec.ownerPattern.matches(owner))
    val floor = CorlexProcessPrivacy.floor(fenceKey)
    if (floor != null && CorlexStateCodec.privacy(floor).getString("sdkChoice") != "granted") return emptySnapshot(floor)
    return locked { snapshot(owner) }
  }
  private fun emptySnapshot(raw: String) = JSONObject().put("privacy", raw).put("rows", JSONObject()).toString()
  private fun snapshot(owner: String? = null): String {
    val raw = privacyText()
    val serial = CorlexProcessPrivacy.lease(fenceKey, raw) ?: throw IllegalStateException("privacy_changed")
    if (raw.isNotEmpty() && CorlexStateCodec.privacy(raw).getString("sdkChoice") != "granted") return emptySnapshot(raw)
    val rows = JSONObject(readState())
    var visible = rows
    if (owner != null) {
      require(CorlexStateCodec.ownerPattern.matches(owner))
      visible = JSONObject()
      if (raw.isNotEmpty()) {
        val record = CorlexStateCodec.privacy(raw); val prefix = "s:$owner:${record.getString("generation")}:"
        if (record.getString("state") == "granted") for (key in rows.keys()) {
          if (key.startsWith(prefix)) visible.put(key, rows.getString(key))
        }
      }
    }
    for (key in visible.keys().asSequence().toList()) if (key.startsWith("m:")) visible.remove(key)
    val result = JSONObject().put("privacy", raw).put("rows", visible)
    if (owner != null && rows.has("m:$owner:consent")) result.put("explicitChoice", rows.getString("m:$owner:consent"))
    if (raw.isEmpty() && rows.opt("corlex_consent") in listOf("denied", "pending")) result.put("legacyChoice", rows.getString("corlex_consent"))
    val resultText = result.toString()
    require(CorlexProcessPrivacy.valid(fenceKey, serial)) { "privacy_changed" }
    return resultText
  }

  fun exchange(command: String, beforePublish: () -> Unit = {}): String {
    require(command.toByteArray(Charsets.UTF_8).size <= CorlexStateCodec.MAX_BYTES)
    CorlexStateCodec.depthAllowed(command, 2)
    val input = JSONObject(command); val expected = input.getString("expected")
    val owner = input.getString("owner")
    require(CorlexStateCodec.ownerPattern.matches(owner))
    if (expected.isNotEmpty()) CorlexStateCodec.privacy(expected)
    val proposed = if (input.has("privacy")) input.getString("privacy") else null
    val negative = proposed != null && CorlexStateCodec.privacy(proposed).getString("state") != "granted"
    val token = if (negative) CorlexProcessPrivacy.refuse(fenceKey, expected, proposed!!) else null
    if (token != null) beforePublish()
    return locked {
    if (token != null) when (CorlexProcessPrivacy.confirm(fenceKey, token, privacyDisk())) {
      CorlexProcessPrivacy.Check.Admitted -> Unit
      else -> return@locked snapshot(owner)
    }
    if (token == null && expected != privacyText()) return@locked snapshot(owner)
    val next = if (input.has("privacy")) input.getString("privacy") else expected
    val record = CorlexStateCodec.privacy(next)
    val previous = if (expected.isEmpty()) null else CorlexStateCodec.privacy(expected)
    val serial = CorlexProcessPrivacy.lease(fenceKey, token?.raw ?: expected) ?: throw IllegalStateException("privacy_changed")
    require(record.getString("state") != "granted" || previous == null || previous.getString("sdkChoice") == "granted" || input.opt("explicitChoice") == "granted")
    val changed = previous?.opt("generation") != record.get("generation") || previous?.opt("state") != record.get("state")
    var rows = JSONObject(readState())
    val floor = CorlexProcessPrivacy.floor(fenceKey)
    if (floor != null && CorlexStateCodec.privacy(floor).getString("sdkChoice") != "granted") rows = JSONObject()
    if (changed) rows = markers(rows)
    if (record.getString("sdkChoice") != "granted") rows = JSONObject()
    applyChanges(input, record, rows)
    if (input.has("explicitChoice")) {
      val choice = input.get("explicitChoice")
      require(choice in CorlexStateCodec.choices)
      rows.put("m:$owner:consent", choice)
    }
    val payload = rows.toString(); CorlexStateCodec.validate(payload)
    if (next != expected && record.getString("state") == "granted") {
      beforePublish()
      if (changed) clearScopes()
      writeState(payload)
      if (!CorlexProcessPrivacy.valid(fenceKey, serial)) return@locked snapshot(owner)
      writeFile(privacyFile, next)
      CorlexProcessPrivacy.granted(fenceKey, serial, next)
    } else {
      if (next != expected) {
        writeFile(privacyFile, next); CorlexProcessPrivacy.wrote(fenceKey, next)
        if (changed) clearScopes()
      }
      writeState(payload)
    }
    snapshot(owner)
    }
  }
  private fun applyChanges(input: JSONObject, record: JSONObject, rows: JSONObject) {
    if (!input.has("changes")) return
    val changes = input.getJSONObject("changes"); val owner = input.getString("owner")
    val generation = input.getString("generation")
    require(changes.length() <= CorlexStateCodec.LIMITS.size && record.getString("state") == "granted" &&
      record.getString("generation") == generation)
    for (key in changes.keys()) {
      require(CorlexStateCodec.LIMITS.containsKey(key))
      val physical = "s:$owner:$generation:$key"
      if (changes.isNull(key)) rows.remove(physical)
      else {
        val value = changes.get(key); require(value is String); rows.put(physical, value)
        if (key == "corlex_consent") {
          require(value in CorlexStateCodec.choices); rows.put("m:$owner:consent", value)
        }
      }
    }
  }
  fun revoke(raw: String, expected: String, beforePublish: () -> Unit = {}): String {
    if (expected.isNotEmpty()) CorlexStateCodec.privacy(expected)
    val record = CorlexStateCodec.privacy(raw)
    require(record.getString("state") == "denied" && record.getString("sdkChoice") == "denied")
    val token = CorlexProcessPrivacy.refuse(fenceKey, expected, raw) ?: return CorlexProcessPrivacy.current(fenceKey) ?: expected
    beforePublish()
    return locked {
      when (val status = CorlexProcessPrivacy.confirm(fenceKey, token, privacyDisk())) {
        CorlexProcessPrivacy.Check.Superseded -> return@locked raw
        is CorlexProcessPrivacy.Check.Stale -> return@locked status.raw
        CorlexProcessPrivacy.Check.Admitted -> Unit
      }
      writeFile(privacyFile, raw); CorlexProcessPrivacy.wrote(fenceKey, raw)
      selected = null
      writeState("{}"); clearScopes()
      raw
    }
  }
  fun observe(expected: String, ceiling: String, beforePublish: () -> Unit = {}): String {
    val record = CorlexStateCodec.privacy(expected)
    val ceilingRank = CorlexStateCodec.choices.indexOf(ceiling); require(ceilingRank >= 0)
    val effective = CorlexStateCodec.choices[maxOf(ceilingRank, CorlexStateCodec.choices.indexOf(record.getString("sdkChoice")))]
    if (effective == record.getString("state")) return currentPrivacy()
    record.put("state", effective).put("generation", java.util.UUID.randomUUID().toString())
    exchange(JSONObject().put("expected", expected).put("owner", "0".repeat(64)).put("privacy", record.toString()).toString(), beforePublish)
    return currentPrivacy()
  }
  private fun markers(rows: JSONObject): JSONObject = JSONObject().also { output ->
    for (key in rows.keys()) if (key.startsWith("m:")) output.put(key, rows.getString(key))
  }
  private fun clearScopes() {
    selected = null
    val scopes = File(directory, "scopes")
    require(!scopes.exists() || scopes.deleteRecursively()) { "state_cleanup_failed" }
  }
  fun <T> withScope(owner: String, generation: String, action: (File) -> T): T = scoped(owner, generation, CorlexScopeOperation(action) {})
  fun <T> scoped(owner: String, generation: String, operation: CorlexScopeOperation<T>): T {
    require(CorlexProcessPrivacy.floor(fenceKey) == null) { "scope_inactive" }
    return locked {
      val raw = privacyText(); val current = CorlexStateCodec.privacy(raw)
      val serial = CorlexProcessPrivacy.lease(fenceKey, raw) ?: throw IllegalStateException("privacy_changed")
      require(selected == owner to generation && current.getString("state") == "granted" && current.getString("generation") == generation)
      val directory = scopeDirectory(owner, generation)
      require(CorlexProcessPrivacy.valid(fenceKey, serial)) { "privacy_changed" }
      try {
        val result = operation.run(directory)
        require(CorlexProcessPrivacy.valid(fenceKey, serial)) { "privacy_changed" }
        result
      } catch (failure: Throwable) { operation.invalidated(); throw failure }
    }
  }
  fun selectScope(owner: String, generation: String, beforeChange: () -> Unit = {}) {
    require(CorlexProcessPrivacy.floor(fenceKey) == null) { "scope_inactive" }
    locked {
    val current = CorlexStateCodec.privacy(privacyText())
    require(CorlexStateCodec.ownerPattern.matches(owner) && CorlexStateCodec.uuid.matches(generation) &&
      current.getString("state") == "granted" && current.getString("generation") == generation)
    scopeDirectory(owner, generation)
    if (selected != owner to generation) beforeChange()
    selected = owner to generation
    }
  }
  private fun selectedDirectory(): File {
    require(CorlexProcessPrivacy.floor(fenceKey) == null) { "scope_inactive" }
    return locked {
    val (owner, generation) = selected ?: throw IllegalStateException("scope_inactive")
    val current = CorlexStateCodec.privacy(privacyText())
    require(current.getString("state") == "granted" && current.getString("generation") == generation)
    scopeDirectory(owner, generation)
    }
  }
  private fun scopeDirectory(owner: String, generation: String): File = File(directory, "scopes/$owner/$generation").also {
    require(it.isDirectory || it.mkdirs()) { "scope_directory_unavailable" }
  }
  companion object {
    private val mutex = Any()
    private var selected: Pair<String, String>? = null
    private fun rootDirectory(context: Context): File = File(context.noBackupFilesDir, "corlex-sdk")
    fun protectedDirectory(context: Context): File = CorlexStateStore(context).selectedDirectory()
  }
}

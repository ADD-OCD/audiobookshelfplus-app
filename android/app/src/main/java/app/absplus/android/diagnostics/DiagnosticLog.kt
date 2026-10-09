package app.absplus.android.diagnostics

import android.content.Context
import android.os.Process
import android.util.Log
import io.paperdb.Paper
import java.io.BufferedWriter
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStreamWriter
import java.io.RandomAccessFile
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicInteger

/**
 * Persistent, size-capped, rolling diagnostic log shared by native code and the JS layer.
 *
 * - Callers only enqueue; one background thread formats, sanitizes and writes, so logging never does
 *   file I/O on the main/player thread.
 * - Files live in private storage (files/diagnostics): absplus-diag.log plus up to 7 rotated files of
 *   ~2 MB each (~16 MB total). Rotation happens on the writer thread only.
 * - Level (NORMAL/DEBUG/VERBOSE) is kept in native SharedPreferences so the playback service can log
 *   correctly with no UI running.
 */
object DiagnosticLog {
  enum class Level { NORMAL, DEBUG, VERBOSE }

  /** Minimum diagnostic level at which an entry is persisted. ALWAYS = persisted at every level. */
  enum class Persist { ALWAYS, DEBUG, VERBOSE }

  const val MAX_FILE_BYTES = 2L * 1024 * 1024
  const val MAX_FILES = 8
  private const val DIR = "diagnostics"
  private const val CURRENT = "absplus-diag.log"
  private const val PREFS = "absplus_diagnostics"
  private const val KEY_LEVEL = "level"
  private const val KEY_LEGACY_MIGRATED = "legacyMigrated"
  private const val KEY_RULES_VERSION = "sanitizerRulesVersion"
  private const val QUEUE_CAPACITY = 20000
  private const val MAX_MESSAGE_CHARS = 8000

  private class Entry(val timestamp: Long, val levelChar: Char, val source: String, val tag: String, val message: String, val pid: Int)

  private val queue = LinkedBlockingQueue<Entry>(QUEUE_CAPACITY)
  private val dropped = AtomicInteger(0)
  private val fileLock = Any()
  private var appContext: Context? = null
  private var writer: BufferedWriter? = null
  private var writerThread: Thread? = null

  @Volatile var level: Level = Level.NORMAL
    private set

  private val dateFormat = ThreadLocal.withInitial { SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSSXXX", Locale.US) }

  fun formatTimestamp(ms: Long): String = dateFormat.get()!!.format(Date(ms))

  /** Safe to call repeatedly from any process entry point (Activity, service, widget receiver). */
  @Synchronized
  fun init(context: Context) {
    if (appContext != null) return
    val ctx = context.applicationContext
    appContext = ctx
    level = try {
      Level.valueOf(prefs(ctx).getString(KEY_LEVEL, Level.NORMAL.name) ?: Level.NORMAL.name)
    } catch (e: Exception) {
      Level.NORMAL
    }
    installCrashHandler()
    writerThread = Thread({ writerLoop() }, "DiagnosticLogWriter").apply {
      isDaemon = true
      priority = Thread.MIN_PRIORITY
      start()
    }
    marker("Application process started (pid ${Process.myPid()}, diagnostic level $level)", Persist.DEBUG)
  }

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setLevel(newLevel: Level) {
    val ctx = appContext ?: return
    prefs(ctx).edit().putString(KEY_LEVEL, newLevel.name).apply()
    val old = level
    level = newLevel
    if (old != newLevel) marker("Diagnostic logging level changed from $old to $newLevel", Persist.ALWAYS)
  }

  fun isPersisted(persist: Persist): Boolean = when (persist) {
    Persist.ALWAYS -> true
    Persist.DEBUG -> level != Level.NORMAL
    Persist.VERBOSE -> level == Level.VERBOSE
  }

  fun write(levelChar: Char, tag: String, message: String, persist: Persist, source: String = "N", timestamp: Long = System.currentTimeMillis()) {
    if (appContext == null || !isPersisted(persist)) return
    // Logging must never throw into the caller (player, service, bridge)
    try {
      val msg = if (message.length > MAX_MESSAGE_CHARS) message.substring(0, MAX_MESSAGE_CHARS) + "…[truncated]" else message
      if (!queue.offer(Entry(timestamp, levelChar, source, tag, msg, Process.myPid()))) dropped.incrementAndGet()
    } catch (t: Throwable) {
      dropped.incrementAndGet()
    }
  }

  fun marker(text: String, persist: Persist = Persist.DEBUG) {
    write('I', "Diagnostics", "--- $text ---", persist)
  }

  // Diagnostics must never crash the app, and nothing is ever written unsanitized (fails closed)
  fun safeSanitize(text: String): String =
    DiagnosticFailClosed.sanitize(text, onFailure = { Log.e("DiagnosticLog", "Sanitizer failed: ${it.javaClass.name}") }) { DiagnosticSanitizer.sanitize(it) }

  private fun formatLine(e: Entry): String {
    val body = safeSanitize(e.message).replace("\r", "").replace("\n", "\n    ")
    return "${formatTimestamp(e.timestamp)} ${e.levelChar} ${e.source}/${safeSanitize(e.tag)} (${e.pid}): $body\n"
  }

  private fun logDir(): File? = appContext?.let { File(it.filesDir, DIR).apply { mkdirs() } }

  private fun rotatedFile(dir: File, index: Int) = File(dir, "$CURRENT.$index")

  /** Oldest first. */
  fun logFiles(): List<File> {
    val dir = logDir() ?: return emptyList()
    val files = mutableListOf<File>()
    for (i in MAX_FILES - 1 downTo 1) rotatedFile(dir, i).takeIf { it.exists() }?.let { files.add(it) }
    File(dir, CURRENT).takeIf { it.exists() }?.let { files.add(it) }
    return files
  }

  fun totalBytes(): Long = synchronized(fileLock) { logFiles().sumOf { it.length() } }

  // Approximate size of the current file (chars written), so rotation needs no per-line stat()
  private var currentBytes = 0L

  private fun openWriter(): BufferedWriter? {
    val dir = logDir() ?: return null
    val file = File(dir, CURRENT)
    currentBytes = file.length()
    val w = BufferedWriter(OutputStreamWriter(FileOutputStream(file, true), Charsets.UTF_8))
    // If a previous process was killed mid-write the file can end in a partial line or a zero-filled
    // block; start on a fresh line so new entries never merge into it
    if (currentBytes > 0 && lastByte(file) != '\n'.code) {
      w.write("\n")
      currentBytes++
    }
    return w
  }

  private fun lastByte(file: File): Int = try {
    RandomAccessFile(file, "r").use { raf -> raf.seek(raf.length() - 1); raf.read() }
  } catch (e: Exception) {
    -1
  }

  /** Zero bytes only appear when a write was interrupted by process death; drop them from reads/exports. */
  private fun withoutNulBytes(bytes: ByteArray): ByteArray = if (bytes.contains(0)) bytes.filter { it != 0.toByte() }.toByteArray() else bytes

  private fun rotate() {
    val dir = logDir() ?: return
    val current = File(dir, CURRENT)
    writer?.flush()
    writer?.close()
    writer = null
    rotatedFile(dir, MAX_FILES - 1).delete()
    for (i in MAX_FILES - 2 downTo 1) {
      val f = rotatedFile(dir, i)
      if (f.exists()) f.renameTo(rotatedFile(dir, i + 1))
    }
    current.renameTo(rotatedFile(dir, 1))
  }

  // True once every stored byte was written or re-sanitized under the current sanitizer rules
  @Volatile private var storedLogsCurrent = false

  private fun writerLoop() {
    migrateLegacyLogs()
    rescrubStoredLogsIfRulesChanged()
    val batch = ArrayList<Entry>(512)
    while (true) {
      try {
        batch.add(queue.take())
        queue.drainTo(batch, 511)
        synchronized(fileLock) { writeBatchLocked(batch) }
      } catch (e: InterruptedException) {
        return
      } catch (e: Throwable) {
        Log.e("DiagnosticLog", "Failed writing diagnostics: $e")
        writer = null
      } finally {
        batch.clear()
      }
    }
  }

  private fun writeLineLocked(line: String) {
    if (writer == null) writer = openWriter()
    val w = writer ?: return
    w.write(line)
    currentBytes += line.length
    if (currentBytes >= MAX_FILE_BYTES) rotate()
  }

  private fun writeBatchLocked(batch: List<Entry>) {
    val droppedCount = dropped.getAndSet(0)
    if (droppedCount > 0) writeLineLocked(formatLine(Entry(System.currentTimeMillis(), 'W', "N", "Diagnostics", "$droppedCount log entries dropped (logging faster than storage)", Process.myPid())))
    for (e in batch) writeLineLocked(formatLine(e))
    writer?.flush()
  }

  /** Writes everything queued so far on the calling thread (used for crashes and before export). */
  fun flushNow() {
    val batch = ArrayList<Entry>()
    queue.drainTo(batch)
    synchronized(fileLock) {
      if (batch.isNotEmpty()) writeBatchLocked(batch)
      writer?.flush()
    }
  }

  private fun installCrashHandler() {
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      try {
        write('E', "Crash", "FATAL uncaught exception on thread ${thread.name}: ${Log.getStackTraceString(throwable)}", Persist.ALWAYS)
        flushNow()
      } catch (_: Throwable) {}
      previous?.uncaughtException(thread, throwable)
    }
  }

  /** Last [maxBytes] of the combined log (oldest->newest), starting at a line boundary. */
  fun readTail(maxBytes: Int): Pair<String, Long> = synchronized(fileLock) {
    writer?.flush()
    val files = logFiles()
    val total = files.sumOf { it.length() }
    val chunks = ArrayDeque<ByteArray>()
    var remaining = maxBytes.toLong()
    for (f in files.asReversed()) {
      if (remaining <= 0) break
      val len = f.length()
      val take = minOf(len, remaining)
      RandomAccessFile(f, "r").use { raf ->
        raf.seek(len - take)
        val buf = ByteArray(take.toInt())
        raf.readFully(buf)
        chunks.addFirst(withoutNulBytes(buf))
      }
      remaining -= take
    }
    var text = chunks.joinToString("") { String(it, Charsets.UTF_8) }
    if (total > maxBytes) text = text.substringAfter('\n', text)
    Pair(resanitizeLines(text), total)
  }

  // Stored lines were sanitized when written, possibly by an older app version with weaker rules.
  // Everything shown or exported is re-sanitized with the current rules (sanitizing is idempotent).
  private fun resanitizeLines(text: String): String {
    val sb = StringBuilder(text.length)
    for (line in text.split('\n')) {
      if (sb.isNotEmpty()) sb.append('\n')
      if (line.isNotEmpty()) sb.append(safeSanitize(line))
    }
    return sb.toString()
  }

  /**
   * When the sanitizer rules change (e.g. after upgrading from an older app version), rewrite the stored
   * log files once with the current rules so nothing unscrubbed stays at rest. Each file is replaced
   * atomically (temp + rename); the version is only recorded after all files are done, so a kill part
   * way through simply redoes it (sanitizing is idempotent).
   */
  private fun rescrubStoredLogsIfRulesChanged() {
    val ctx = appContext ?: return
    if (prefs(ctx).getInt(KEY_RULES_VERSION, 0) == DiagnosticSanitizer.RULES_VERSION) {
      storedLogsCurrent = true
      return
    }
    try {
      val started = System.currentTimeMillis()
      var files = 0
      for (f in logFiles()) {
        synchronized(fileLock) {
          if (f.name == CURRENT) {
            writer?.flush()
            writer?.close()
            writer = null
          }
          if (!f.exists()) return@synchronized
          val tmp = File(f.parentFile, "${f.name}.rescrub")
          OutputStreamWriter(FileOutputStream(tmp), Charsets.UTF_8).buffered().use { out ->
            withoutNulReader(f).useLines { lines -> lines.forEach { line -> if (line.isNotEmpty()) { out.write(safeSanitize(line)); out.write("\n") } } }
          }
          if (!tmp.renameTo(f)) {
            f.delete()
            tmp.renameTo(f)
          }
          files++
        }
      }
      prefs(ctx).edit().putInt(KEY_RULES_VERSION, DiagnosticSanitizer.RULES_VERSION).apply()
      storedLogsCurrent = true
      if (files > 0) marker("Stored diagnostic log re-sanitized with current privacy rules ($files files, ${System.currentTimeMillis() - started} ms)", Persist.ALWAYS)
    } catch (t: Throwable) {
      Log.e("DiagnosticLog", "Re-sanitizing stored logs failed: ${t.javaClass.name}")
    }
  }

  private fun withoutNulReader(f: File) = java.io.InputStreamReader(object : java.io.FilterInputStream(f.inputStream()) {
    override fun read(): Int {
      var b = super.read()
      while (b == 0) b = super.read()
      return b
    }
    override fun read(b: ByteArray, off: Int, len: Int): Int {
      while (true) {
        val n = super.read(b, off, len)
        if (n <= 0) return n
        var w = off
        for (i in off until off + n) if (b[i] != 0.toByte()) b[w++] = b[i]
        if (w > off) return w - off
      }
    }
  }, Charsets.UTF_8).buffered()

  /** Writes [header] then the whole log (oldest->newest) into [dest]; stored lines are re-sanitized if not yet current. */
  fun exportTo(dest: File, header: String) {
    flushNow()
    if (storedLogsCurrent) {
      // Fast path: every stored byte is already sanitized with the current rules; only strip NUL bytes
      synchronized(fileLock) {
        FileOutputStream(dest).use { out ->
          out.write(header.toByteArray(Charsets.UTF_8))
          val buf = ByteArray(64 * 1024)
          for (f in logFiles()) f.inputStream().use { input ->
            while (true) {
              val n = input.read(buf)
              if (n < 0) break
              out.write(withoutNulBytes(buf.copyOf(n)))
            }
          }
        }
      }
      return
    }
    val started = System.currentTimeMillis()
    var lineCount = 0
    val raw = File(dest.parentFile, "${dest.name}.raw")
    // Copy under the lock (fast), sanitize outside it so logging isn't held up by a large export
    synchronized(fileLock) {
      FileOutputStream(raw).use { out ->
        val buf = ByteArray(64 * 1024)
        for (f in logFiles()) f.inputStream().use { input ->
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(withoutNulBytes(buf.copyOf(n)))
          }
        }
      }
    }
    val copied = System.currentTimeMillis()
    try {
      OutputStreamWriter(FileOutputStream(dest), Charsets.UTF_8).buffered().use { out ->
        out.write(header)
        raw.bufferedReader(Charsets.UTF_8).useLines { lines ->
          lines.forEach { line ->
            lineCount++
            if (line.isNotEmpty()) out.write(safeSanitize(line))
            out.write("\n")
          }
        }
      }
    } finally {
      raw.delete()
    }
    write('D', "Diagnostics", "Diagnostic export: $lineCount lines, ${dest.length()} bytes, copy ${copied - started} ms, re-sanitize ${System.currentTimeMillis() - copied} ms", Persist.DEBUG)
  }

  /** Deletes only the diagnostic log files. */
  fun clear() {
    queue.clear()
    synchronized(fileLock) {
      writer?.close()
      writer = null
      currentBytes = 0L
      logDir()?.listFiles()?.filter { it.name.startsWith(CURRENT) }?.forEach { it.delete() }
      // Nothing written under older sanitizer rules remains
      appContext?.let { prefs(it).edit().putInt(KEY_RULES_VERSION, DiagnosticSanitizer.RULES_VERSION).apply() }
      storedLogsCurrent = true
    }
    marker("Diagnostic logs cleared (level $level)", Persist.ALWAYS)
  }

  // One-time import of logs from the old per-entry Paper store, then that store is removed
  private fun migrateLegacyLogs() {
    val ctx = appContext ?: return
    if (prefs(ctx).getBoolean(KEY_LEGACY_MIGRATED, false)) return
    try {
      val book = Paper.book("log")
      val legacy = book.allKeys.mapNotNull { key ->
        try { book.read<app.absplus.android.plugins.AbsLog>(key) } catch (e: Exception) { null }
      }.sortedBy { it.timestamp }
      if (legacy.isNotEmpty()) {
        synchronized(fileLock) {
          writeBatchLocked(listOf(Entry(System.currentTimeMillis(), 'I', "N", "Diagnostics", "--- Imported ${legacy.size} entries from the previous app log ---", Process.myPid())) +
            legacy.map { Entry(it.timestamp, if (it.level == "error") 'E' else 'I', "N", it.tag.ifEmpty { "AbsLogger" }, it.message, 0) })
        }
      }
      book.destroy()
    } catch (e: Throwable) {
      Log.e("DiagnosticLog", "Legacy log migration failed: $e")
    }
    prefs(ctx).edit().putBoolean(KEY_LEGACY_MIGRATED, true).apply()
  }
}

/**
 * Drop-in for android.util.Log in playback/session code: always logs to Logcat exactly as before, and
 * persists to the diagnostic log when the level allows (d/i/w/e at DEBUG+, v at VERBOSE).
 */
object DLog {
  // The logcat copy is sanitized like the diagnostic log: raw logcat is readable over adb and in bug reports
  fun v(tag: String, msg: String): Int { DiagnosticLog.write('V', tag, msg, DiagnosticLog.Persist.VERBOSE); return Log.v(tag, DiagnosticLog.safeSanitize(msg)) }
  fun d(tag: String, msg: String): Int { DiagnosticLog.write('D', tag, msg, DiagnosticLog.Persist.DEBUG); return Log.d(tag, DiagnosticLog.safeSanitize(msg)) }
  fun i(tag: String, msg: String): Int { DiagnosticLog.write('I', tag, msg, DiagnosticLog.Persist.DEBUG); return Log.i(tag, DiagnosticLog.safeSanitize(msg)) }
  fun w(tag: String, msg: String): Int { DiagnosticLog.write('W', tag, msg, DiagnosticLog.Persist.DEBUG); return Log.w(tag, DiagnosticLog.safeSanitize(msg)) }
  fun w(tag: String, msg: String, tr: Throwable): Int { DiagnosticLog.write('W', tag, "$msg\n${Log.getStackTraceString(tr)}", DiagnosticLog.Persist.DEBUG); return Log.w(tag, DiagnosticLog.safeSanitize(msg), tr) }
  fun e(tag: String, msg: String): Int { DiagnosticLog.write('E', tag, msg, DiagnosticLog.Persist.DEBUG); return Log.e(tag, DiagnosticLog.safeSanitize(msg)) }
  fun e(tag: String, msg: String, tr: Throwable): Int { DiagnosticLog.write('E', tag, "$msg\n${Log.getStackTraceString(tr)}", DiagnosticLog.Persist.DEBUG); return Log.e(tag, msg, tr) }
  fun marker(text: String) = DiagnosticLog.marker(text)
}

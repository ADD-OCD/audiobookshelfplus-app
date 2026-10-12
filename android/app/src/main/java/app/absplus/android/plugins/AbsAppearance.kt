package app.absplus.android.plugins

import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import app.absplus.android.appearance.DeviceAppearance
import app.absplus.android.appearance.DevicePaletteReader
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.UUID

/**
 * Device appearance for RICE "Follow device" (docs/rice-customization.md): light/dark, the Android 12+ public system
 * palette and the Android 14+ contrast level, plus the app-owned window background behind the WebView's inset margins.
 *
 * Changes are noticed through Capacitor's configuration and resume callbacks (no polling, no service), coalesced, and
 * sent only when the content actually changed. Each plugin instance has its own session id and a monotonic sequence,
 * so the WebView can order snapshots and ignore ones from a previous instance. The only input it accepts is a revision,
 * a boolean, three color channels and an icon style: never resource names, paths or methods.
 */
@CapacitorPlugin(name = "AbsAppearance")
class AbsAppearance : Plugin() {
  private val main = Handler(Looper.getMainLooper())
  private val sessionId = UUID.randomUUID().toString()
  private var sequence = 0L
  private var lastSent: String? = null
  // The theme gives every activity view the #232323 background (styles.xml android:background), so the layers that
  // show through the WebView's system-bar margins are its parents, not only the window. Originals are kept to restore.
  private val originalBackgrounds = LinkedHashMap<android.view.View, Drawable?>()
  private var lastAppliedRevision = 0L
  private val emit = Runnable { emitIfChanged() }

  @PluginMethod
  fun getDeviceAppearance(call: PluginCall) {
    val snapshot = DevicePaletteReader.read(context)
    call.resolve(toJs(snapshot, nextSequence()))
  }

  override fun handleOnConfigurationChanged(newConfig: Configuration?) {
    super.handleOnConfigurationChanged(newConfig)
    schedule()
  }

  override fun handleOnResume() {
    super.handleOnResume()
    schedule()
  }

  override fun handleOnDestroy() {
    main.removeCallbacks(emit)
    originalBackgrounds.clear()
    super.handleOnDestroy()
  }

  // 100 ms trailing coalescing: one snapshot per burst of configuration events
  private fun schedule() {
    main.removeCallbacks(emit)
    main.postDelayed(emit, COALESCE_MS)
  }

  private fun emitIfChanged() {
    val snapshot = DevicePaletteReader.read(context)
    val key = "${snapshot.paletteRevision()}|${snapshot.night}|${snapshot.contrast}"
    if (key == lastSent) return
    lastSent = key
    notifyListeners("deviceAppearanceChanged", toJs(snapshot, nextSequence()))
  }

  private fun nextSequence(): Long = synchronized(this) { ++sequence }

  private fun toJs(snapshot: DeviceAppearance, seq: Long): JSObject {
    val js = JSObject()
      .put("apiLevel", snapshot.apiLevel)
      .put("paletteAvailable", snapshot.paletteAvailable)
      .put("night", snapshot.night)
      .put("fontScale", snapshot.fontScale.toDouble())
      .put("sessionId", sessionId)
      .put("sequence", seq)
      .put("paletteRevision", snapshot.paletteRevision())
    js.put("contrast", snapshot.contrast ?: JSObject.NULL)
    val tones = snapshot.tones
    if (tones == null) js.put("tones", JSObject.NULL)
    else {
      val groups = JSObject()
      for ((group, values) in tones) {
        val toneObject = JSObject()
        for ((tone, rgb) in values) toneObject.put(tone, JSArray().apply { rgb.forEach { put(it) } })
        groups.put(group, toneObject)
      }
      js.put("tones", groups)
    }
    if (lastSent == null) lastSent = "${snapshot.paletteRevision()}|${snapshot.night}|${snapshot.contrast}"
    return js
  }

  /**
   * Paints the app-owned background behind the WebView's system-bar margins for a RICE appearance, or restores the
   * original window background (the built-ins' #232323) when disabled. Inset handling is untouched.
   */
  @PluginMethod
  fun applyNativeAppearance(call: PluginCall) {
    val revision = call.getLong("revision") ?: 0L
    val enabled = call.getBoolean("enabled") ?: false
    val background = call.getArray("background")
    val channels = runCatching { IntArray(3) { background.getInt(it) } }.getOrNull()
    if (revision < 0 || channels == null || background.length() != 3 || channels.any { it !in 0..255 }) {
      call.reject("Invalid appearance")
      return
    }
    val act = activity ?: return call.resolve()
    act.runOnUiThread {
      if (revision < lastAppliedRevision) return@runOnUiThread call.resolve() // a late call for an older selection
      lastAppliedRevision = revision
      if (originalBackgrounds.isEmpty()) {
        var view: android.view.View? = bridge?.webView?.parent as? android.view.View
        while (view != null) {
          originalBackgrounds[view] = view.background
          view = view.parent as? android.view.View
        }
      }
      val color = (0xFF shl 24) or (channels[0] shl 16) or (channels[1] shl 8) or channels[2]
      for ((view, original) in originalBackgrounds) view.background = if (enabled) ColorDrawable(color) else original
      call.resolve()
    }
  }

  companion object {
    private const val COALESCE_MS = 100L
  }
}

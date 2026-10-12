package app.absplus.android.appearance

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import androidx.annotation.RequiresApi

/**
 * The device's public appearance: light/dark (uiMode), the Android 12+ system tonal palette (android.R.color
 * system_accent1..3 / system_neutral1..2, the colors Samsung One UI's Color palette also publishes) and the Android 14+
 * contrast level. Public resources only: no wallpaper bitmap, no Samsung settings, no private APIs.
 */
data class DeviceAppearance(
  val apiLevel: Int,
  val night: Boolean,
  /** -1..1 on Android 14+, else null. Diagnostic of the user's request; never lowers app minimums. */
  val contrast: Double?,
  val fontScale: Float,
  /** group (accent1, accent2, accent3, neutral1, neutral2) -> tone ("0".."1000") -> rgb; null before Android 12 */
  val tones: Map<String, Map<String, IntArray>>?
) {
  val paletteAvailable get() = tones != null

  /** Content hash for de-duplication only (not ordering). */
  fun paletteRevision(): String {
    val t = tones ?: return "none"
    val sb = StringBuilder()
    for (group in GROUPS) for (tone in TONES) t[group]?.get(tone)?.let { sb.append(it[0]).append(',').append(it[1]).append(',').append(it[2]).append(';') }
    return sb.toString().hashCode().toUInt().toString(16)
  }

  companion object {
    val GROUPS = listOf("accent1", "accent2", "accent3", "neutral1", "neutral2")
    val TONES = listOf("0", "10", "50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000")
  }
}

object DevicePaletteReader {
  fun read(context: Context): DeviceAppearance {
    val configuration = context.resources.configuration
    val night = (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val contrast =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        runCatching { (context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager).contrast.toDouble() }.getOrNull()?.takeIf { it.isFinite() && it in -1.0..1.0 }
      } else null
    val tones = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) runCatching { readTones(context) }.getOrNull() else null
    return DeviceAppearance(Build.VERSION.SDK_INT, night, contrast, configuration.fontScale, tones)
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun readTones(context: Context): Map<String, Map<String, IntArray>> =
    resourceIds().mapValues { (_, ids) ->
      DeviceAppearance.TONES.zip(ids).associate { (tone, id) ->
        val argb = context.getColor(id)
        tone to intArrayOf((argb shr 16) and 0xFF, (argb shr 8) and 0xFF, argb and 0xFF)
      }
    }

  /** Explicit public resource ids per group, in DeviceAppearance.TONES order. */
  @RequiresApi(Build.VERSION_CODES.S)
  fun resourceIds(): Map<String, List<Int>> =
    mapOf(
      "accent1" to listOf(android.R.color.system_accent1_0, android.R.color.system_accent1_10, android.R.color.system_accent1_50, android.R.color.system_accent1_100, android.R.color.system_accent1_200, android.R.color.system_accent1_300, android.R.color.system_accent1_400, android.R.color.system_accent1_500, android.R.color.system_accent1_600, android.R.color.system_accent1_700, android.R.color.system_accent1_800, android.R.color.system_accent1_900, android.R.color.system_accent1_1000),
      "accent2" to listOf(android.R.color.system_accent2_0, android.R.color.system_accent2_10, android.R.color.system_accent2_50, android.R.color.system_accent2_100, android.R.color.system_accent2_200, android.R.color.system_accent2_300, android.R.color.system_accent2_400, android.R.color.system_accent2_500, android.R.color.system_accent2_600, android.R.color.system_accent2_700, android.R.color.system_accent2_800, android.R.color.system_accent2_900, android.R.color.system_accent2_1000),
      "accent3" to listOf(android.R.color.system_accent3_0, android.R.color.system_accent3_10, android.R.color.system_accent3_50, android.R.color.system_accent3_100, android.R.color.system_accent3_200, android.R.color.system_accent3_300, android.R.color.system_accent3_400, android.R.color.system_accent3_500, android.R.color.system_accent3_600, android.R.color.system_accent3_700, android.R.color.system_accent3_800, android.R.color.system_accent3_900, android.R.color.system_accent3_1000),
      "neutral1" to listOf(android.R.color.system_neutral1_0, android.R.color.system_neutral1_10, android.R.color.system_neutral1_50, android.R.color.system_neutral1_100, android.R.color.system_neutral1_200, android.R.color.system_neutral1_300, android.R.color.system_neutral1_400, android.R.color.system_neutral1_500, android.R.color.system_neutral1_600, android.R.color.system_neutral1_700, android.R.color.system_neutral1_800, android.R.color.system_neutral1_900, android.R.color.system_neutral1_1000),
      "neutral2" to listOf(android.R.color.system_neutral2_0, android.R.color.system_neutral2_10, android.R.color.system_neutral2_50, android.R.color.system_neutral2_100, android.R.color.system_neutral2_200, android.R.color.system_neutral2_300, android.R.color.system_neutral2_400, android.R.color.system_neutral2_500, android.R.color.system_neutral2_600, android.R.color.system_neutral2_700, android.R.color.system_neutral2_800, android.R.color.system_neutral2_900, android.R.color.system_neutral2_1000)
    )
}

/** Colors the widget applies (WidgetRenderer). Same roles as theme/rice/mapping.js widgetColors. */
data class WidgetPalette(val background: IntArray, val surface: IntArray, val text: IntArray, val muted: IntArray, val icon: IntArray, val track: IntArray, val played: IntArray)

/**
 * Device tones -> widget colors: steps 1-6 of theme/rice/mapping.js mapPalette, in the same order with the same blends
 * and repairs, so the home-screen widget matches the app's "Follow device" appearance without the WebView.
 */
object DevicePaletteMapper {
  private val ROLES = mapOf(
    "background" to (("neutral1" to "900") to ("neutral1" to "10")),
    "raised" to (("neutral1" to "800") to ("neutral1" to "50")),
    "hover" to (("neutral2" to "700") to ("neutral2" to "100")),
    "foreground" to (("neutral1" to "50") to ("neutral1" to "900")),
    "muted" to (("neutral2" to "200") to ("neutral2" to "700")),
    "accent" to (("accent1" to "200") to ("accent1" to "600"))
  )

  fun widgetPalette(tones: Map<String, Map<String, IntArray>>?, night: Boolean, highContrast: Boolean = false): WidgetPalette? {
    if (tones == null) return null
    fun pick(role: String): IntArray? {
      val (dark, light) = ROLES.getValue(role)
      val (group, tone) = if (night) dark else light
      return tones[group]?.get(tone)?.copyOf()
    }
    val bg = pick("background") ?: return null
    val raised = pick("raised") ?: return null
    val hover = pick("hover") ?: return null
    val rawFg = pick("foreground") ?: return null
    val rawMuted = pick("muted") ?: return null
    val accent = pick("accent") ?: return null
    val text = if (highContrast) 7.0 else 4.5
    val control = if (highContrast) 4.5 else 3.0
    val fg = RiceColor.repair(rawFg, listOf(bg, raised, hover).map { RiceColor.Constraint(it, text) })
    val muted = RiceColor.repair(rawMuted, listOf(bg, raised).map { RiceColor.Constraint(it, text) })
    val played = RiceColor.repair(accent, listOf(RiceColor.Constraint(bg, control)))
    val track = RiceColor.repair(RiceColor.blend(bg, fg, 0.25), listOf(RiceColor.Constraint(played, control)))
    return WidgetPalette(background = bg, surface = raised, text = fg, muted = muted, icon = fg.copyOf(), track = track, played = played)
  }
}

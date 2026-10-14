package app.absplus.android.widget

import android.content.Context
import android.os.Build
import app.absplus.android.appearance.AppearanceSnapshotReader
import app.absplus.android.appearance.DevicePaletteMapper
import app.absplus.android.appearance.DevicePaletteReader
import app.absplus.android.appearance.WidgetPalette

/**
 * Which repository-owned widget presentation to use. Only saved theme data is read (the app's committed RICE store, or
 * before that the built-in id the $theme service persists); it is matched against a fixed allow-list and never used as
 * a drawable name, resource id, path or style. Unknown, custom, missing or unreadable values fall back to the standard
 * widget look.
 */
enum class WidgetTheme {
  /** The existing widget look, used for Dark, Black and Light. */
  STANDARD,

  /** LLAMA equipment look (resources generated from theme/builtins.js). */
  LLAMA;

  companion object {
    /** Fixed allow-list: built-in theme ids that have their own native widget presentation. */
    fun fromThemeId(themeId: String?): WidgetTheme =
      when (themeId) {
        "llama" -> LLAMA
        else -> STANDARD
      }

    fun current(context: Context): WidgetTheme = look(context).theme

    /**
     * The widget's layout family and, for a RICE appearance on Android 12+, the colors to apply over the standard
     * layouts. LLAMA-family RICE copies keep the LLAMA widget as it is. Device mode re-reads the device's public
     * palette at every update, so the widget follows it even when the app isn't running.
     */
    fun look(context: Context): WidgetLook =
      when (val committed = AppearanceSnapshotReader.read(context)) {
        is AppearanceSnapshotReader.Committed.Builtin -> WidgetLook(fromThemeId(committed.themeId), null)
        is AppearanceSnapshotReader.Committed.Rice -> {
          if (committed.family == "llama") WidgetLook(LLAMA, null)
          else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) WidgetLook(STANDARD, null)
          else if (committed.deviceMode != null) {
            val device = DevicePaletteReader.read(context)
            val night = committed.deviceMode == "dark" || device.night
            WidgetLook(STANDARD, DevicePaletteMapper.widgetPalette(device.tones, night, (device.contrast ?: 0.0) > 0))
          } else WidgetLook(STANDARD, committed.palette)
        }
      }
  }
}

/** A widget presentation: [palette] is null for the unmodified built-in resources. */
data class WidgetLook(val theme: WidgetTheme, val palette: WidgetPalette?)

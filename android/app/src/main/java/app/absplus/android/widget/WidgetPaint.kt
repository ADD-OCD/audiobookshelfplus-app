package app.absplus.android.widget

import android.content.res.ColorStateList
import android.os.Build
import android.widget.RemoteViews
import app.absplus.android.R
import app.absplus.android.appearance.RiceColor
import app.absplus.android.appearance.WidgetPalette

/**
 * RICE colors over the standard widget layouts (docs/rice-customization.md, "Widget"). Kept apart from WidgetRenderer
 * so the built-in widget paths stay exactly as they were: with no palette (Dark, Black, Light, LLAMA, LLAMA-family
 * RICE copies, or Android 11 and older) this does nothing.
 *
 * Android 12+ only: tints keep the launcher-clipped rounded container and the button shapes, and only views present in
 * every standard layout of the given size are touched. Ids, actions, sizes, artwork and state are unchanged; no timers.
 */
object WidgetPaint {
  fun apply(views: RemoteViews, size: WidgetSize, look: WidgetLook) {
    val palette = look.palette ?: return
    if (look.theme != WidgetTheme.STANDARD || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    applyPalette(views, size, palette)
  }

  internal fun applyPalette(views: RemoteViews, size: WidgetSize, palette: WidgetPalette) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val tint = { c: IntArray -> ColorStateList.valueOf(RiceColor.toArgb(c)) }
    views.setColorStateList(R.id.widgetBackground, "setBackgroundTintList", tint(palette.background))
    views.setColorStateList(R.id.widgetContent, "setBackgroundTintList", tint(palette.background))
    views.setColorStateList(R.id.widgetButtonContainer, "setBackgroundTintList", tint(palette.background))
    views.setTextColor(R.id.widgetMediaTitle, RiceColor.toArgb(palette.text))
    views.setTextColor(R.id.widgetArtistText, RiceColor.toArgb(palette.muted))
    for (id in intArrayOf(R.id.widgetRewindButton, R.id.widgetPlayPauseButton, R.id.widgetFastForwardButton)) views.setInt(id, "setColorFilter", RiceColor.toArgb(palette.icon))
    if (size == WidgetSize.FULL) {
      views.setTextColor(R.id.widgetElapsedText, RiceColor.toArgb(palette.text))
      views.setTextColor(R.id.widgetRemainingText, RiceColor.toArgb(palette.text))
      views.setColorStateList(R.id.widgetProgress, "setProgressTintList", tint(palette.played))
      views.setColorStateList(R.id.widgetProgress, "setProgressBackgroundTintList", tint(palette.track))
    }
  }
}

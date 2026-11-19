package app.absplus.android

import app.absplus.android.media.readSavedPlaybackRate
import app.absplus.android.diagnostics.DLog
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle
import app.absplus.android.data.PlaybackSession
import app.absplus.android.device.DeviceManager
import app.absplus.android.managers.DbManager
import app.absplus.android.widget.WidgetRenderer

/**
 * The home-screen media widget. One provider for every size; the presentation adapts to the widget's
 * actual size (see widget/WidgetSize and widget/WidgetRenderer).
 */
class MediaPlayerWidget : AppWidgetProvider() {
  val tag = "MediaPlayerWidget"

  // Launcher-requested updates (placement, upgrade, launcher restart): draw the last known state so a
  // placed widget gets the current layouts. This only renders; it never starts or restores playback.
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    DLog.d(tag, "onUpdate ${appWidgetIds.size} widget(s)")
    WidgetRenderer.renderAll(context, appWidgetIds)
  }

  // API 24-30 pick their layout from the reported size; Android 12+ also redraws harmlessly
  override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle?) {
    DLog.d(tag, "onAppWidgetOptionsChanged $appWidgetId")
    WidgetRenderer.renderAll(context, intArrayOf(appWidgetId))
  }

  override fun onEnabled(context: Context) {
    DLog.i(tag, "onEnabled check context ${context.packageName}")

    DbManager.initialize(context)

    DeviceManager.deviceData.lastPlaybackSession?.let {
      DLog.d(tag, "Setting initial widget state with last playback session ${it.displayTitle}")
      WidgetRenderer.renderAll(context)
    }

    // Enter relevant functionality for when the first widget is created
    DeviceManager.initializeWidgetUpdater(context)
  }
}

/**
 * @param showControls true when there is a live session or a resumable one (Play restores it);
 *   false only when nothing can be played, e.g. after the user explicitly closed playback
 * @param positionMs / durationMs the known position and length for the progress snapshot, when available
 * @param speed the live player's speed for the snapshot times, when there is one
 */
internal fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, playbackSession: PlaybackSession?, isPlaying: Boolean, showControls: Boolean, positionMs: Long? = null, durationMs: Long? = null, speed: Float? = null) {
  DLog.i("MediaPlayerWidget", "updateAppWidget ${playbackSession?.displayTitle ?: "No Title"} isPlaying=$isPlaying showControls=$showControls")
  val position = positionMs ?: playbackSession?.let { (it.currentTime * 1000).toLong() }
  val duration = durationMs ?: playbackSession?.let { (it.duration * 1000).toLong() }
  // Without a live player, the speed the user last chose
  val rate = speed ?: readSavedPlaybackRate(context) ?: 1f
  WidgetRenderer.update(context, appWidgetManager, appWidgetId, WidgetRenderer.State(playbackSession, isPlaying, showControls, position, duration, rate))
}

package app.absplus.android.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import android.widget.RemoteViews
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import app.absplus.android.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Lays out the real widget RemoteViews (built by WidgetRenderer, sized by FullArtwork) at exact dp sizes and font
 * scales with real text metrics (native graphics), then checks text containment and geometry.
 *
 * HARD INVARIANTS (asserted): the LLAMA sizes below fit their text; cover, progress, controls and the brand icon keep
 * their pre-Gate-F geometry in both themes; the icon never takes layout space and never overlaps content.
 *
 * KNOWN LIMITATIONS (measured, deliberately NOT asserted as fitting; a shared responsive-layout issue, see
 * docs/widget-architecture.md). With a long two-line title, LLAMA still clips at font scale 1.0 for FULL NORMAL
 * heights below ~174dp, FULL NORMAL widths around 250dp at every NORMAL height, COMPACT at or below ~72dp tall and
 * WIDE at or below ~80dp tall; at 1.3 FULL NORMAL clips at most narrow sizes, COMPACT at or below ~88dp and WIDE at
 * or below ~96dp. The standard themes clip in the same places (unchanged by Gate F).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w411dp-h914dp-420dpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WidgetContainmentTest {
  private val longTitle = "A Very Long Audiobook Title That Keeps Going: Book Twelve of the Endless Saga (Unabridged)"
  private val longAuthor = "Firstname Middlename Lastname, Narrated by Someone Else Entirely"

  private class Rendered(val root: View, val density: Float, val plan: FullArtwork.Plan?) {
    fun view(id: Int): View? = root.findViewById<View>(id)?.takeIf { shown(it) }

    fun boundsDp(id: Int): List<Float>? = view(id)?.let { v -> bounds(v).map { Math.round(it / density * 10) / 10f } }

    /** Text views whose laid-out text is taller than the space they were given. */
    fun clipped(): List<String> =
      listOf(R.id.widgetMediaTitle to "title", R.id.widgetArtistText to "author", R.id.widgetElapsedText to "elapsed", R.id.widgetRemainingText to "remaining").mapNotNull { (id, name) ->
        val t = view(id) as? TextView ?: return@mapNotNull null
        val needed = t.layout.height + t.compoundPaddingTop + t.compoundPaddingBottom
        name.takeIf { needed > t.height + 1 }
      }

    private fun shown(v: View): Boolean {
      var cur: View? = v
      while (cur != null) {
        if (cur.visibility != View.VISIBLE) return false
        if (cur === root) return true
        cur = cur.parent as? View
      }
      return true
    }

    private fun bounds(v: View): List<Int> {
      var x = 0
      var y = 0
      var cur: View? = v
      while (cur != null && cur !== root) {
        x += cur.left
        y += cur.top
        cur = cur.parent as? View
      }
      return listOf(x, y, v.width, v.height)
    }
  }

  /** WidgetRenderer.build (private) with stand-in click intents; the views, ids and visibility logic are the real ones. */
  private fun buildViews(context: Context, size: WidgetSize, theme: WidgetTheme, plan: FullArtwork.Plan?): RemoteViews {
    val actionsClass = Class.forName("app.absplus.android.widget.WidgetRenderer\$Actions")
    val intent = PendingIntent.getActivity(context, 0, Intent(), PendingIntent.FLAG_IMMUTABLE)
    val actions = actionsClass.declaredConstructors.first { it.parameterCount == 4 }.apply { isAccessible = true }.newInstance(intent, intent, intent, intent)
    val build = WidgetRenderer::class.java.declaredMethods.first { it.name == "build" && it.parameterCount == 7 }.apply { isAccessible = true }
    val state = WidgetRenderer.State(session = null, isPlaying = false, showControls = true, positionMs = 5_000_000L, durationMs = 41_000_000L)
    val cover = WidgetRenderer.widgetArtwork(Bitmap.createBitmap(300, 300, Bitmap.Config.ARGB_8888))
    // build takes a WidgetLook since RICE; no palette = the unchanged built-in widget
    return build.invoke(WidgetRenderer, context, size, WidgetLook(theme, null), state, cover, actions, plan) as RemoteViews
  }

  private fun render(theme: WidgetTheme, widthDp: Float, heightDp: Float, fontScale: Float = 1f, title: String = longTitle, author: String = longAuthor, forceIcons: Boolean? = null): Rendered {
    RuntimeEnvironment.setFontScale(fontScale)
    val context: Context = ApplicationProvider.getApplicationContext()
    val density = context.resources.displayMetrics.density
    val size = WidgetSize.classify(widthDp, heightDp)
    val plan = if (size == WidgetSize.FULL) FullArtwork.plan(widthDp, heightDp, fontScale) else null
    val views = buildViews(context, size, theme, plan)
    views.setTextViewText(R.id.widgetMediaTitle, title)
    views.setTextViewText(R.id.widgetArtistText, author)
    val parent = FrameLayout(context)
    val root = LayoutInflater.from(context).inflate(views.layoutId, parent, false)
    views.reapply(context, root)
    if (forceIcons != null) {
      for (id in listOf(R.id.tinyCornerIcon, R.id.tinyCornerIconPanel)) root.findViewById<View>(id)?.visibility = if (forceIcons) View.VISIBLE else View.GONE
    }
    parent.addView(root)
    val w = Math.round(widthDp * density)
    val h = Math.round(heightDp * density)
    parent.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
    parent.layout(0, 0, w, h)
    return Rendered(root, density, plan)
  }

  private fun assertFits(theme: WidgetTheme, widths: List<Int>, heights: IntProgression, fontScale: Float, author: String = longAuthor) {
    val failures = mutableListOf<String>()
    for (w in widths) for (h in heights) {
      val clipped = render(theme, w.toFloat(), h.toFloat(), fontScale, author = author).clipped()
      if (clipped.isNotEmpty()) failures += "${w}x${h}dp@$fontScale: $clipped"
    }
    assertTrue("clipped text: $failures", failures.isEmpty())
  }

  @Test
  fun llamaFullNormalReportedSizeFitsATwoLineTitle() {
    // The S26 report: ~291x174dp FULL NORMAL with a two-line title squeezed the time row to ~2dp before Gate F
    val r = render(WidgetTheme.LLAMA, 291f, 174f, author = "Test Author")
    assertEquals(FullArtwork.Presentation.NORMAL, r.plan?.presentation)
    assertEquals(2, (r.view(R.id.widgetMediaTitle) as TextView).layout.lineCount)
    assertEquals(emptyList<String>(), r.clipped())
    assertTrue("time row visible at full height", r.boundsDp(R.id.widgetTimeRow)!![3] >= 15f)
  }

  @Test
  fun llamaFullNormalFitsAtTwoRowHeights() {
    assertFits(WidgetTheme.LLAMA, listOf(291, 320, 360, 400), 174..300 step 6, 1f, author = "Test Author")
    assertFits(WidgetTheme.LLAMA, listOf(360, 400), 192..300 step 6, 1.3f, author = "Test Author")
  }

  @Test
  fun llamaCompactFits() {
    assertFits(WidgetTheme.LLAMA, listOf(250, 276, 300), 76..120 step 4, 1f)
    assertFits(WidgetTheme.LLAMA, listOf(250, 276, 300), 92..120 step 4, 1.3f)
  }

  @Test
  fun llamaWideFits() {
    assertFits(WidgetTheme.LLAMA, listOf(320, 360, 480), 88..144 step 8, 1f)
    assertFits(WidgetTheme.LLAMA, listOf(320, 360, 480), 104..144 step 8, 1.3f)
  }

  @Test
  fun llamaExpandedAndLargeFit() {
    for (font in listOf(1f, 1.3f)) for ((w, h) in listOf(291 to 330, 360 to 420, 360 to 640, 496 to 760)) {
      val r = render(WidgetTheme.LLAMA, w.toFloat(), h.toFloat(), font)
      assertTrue("${w}x$h", r.plan?.presentation != FullArtwork.Presentation.NORMAL)
      assertEquals("${w}x$h@$font", emptyList<String>(), r.clipped())
    }
  }

  @Test
  fun coverControlsAndIconKeepTheirGeometry() {
    // Pre-Gate-F geometry in dp (x, y, width, height); Gate F changes only text spacing and paint
    val expected =
      mapOf(
        Triple(WidgetTheme.LLAMA, 276, 90) to listOf(listOf(8f, 8f, 88.4f, 73.9f), listOf(102.5f, 45f, 132.6f, 37f), listOf(149.7f, 48f, 38.1f, 30.9f)),
        Triple(WidgetTheme.LLAMA, 360, 90) to listOf(listOf(8f, 8f, 73.9f, 73.9f), listOf(88f, 46.9f, 233.9f, 35f), listOf(167.6f, 48.8f, 74.3f, 31.2f)),
        Triple(WidgetTheme.LLAMA, 291, 174) to listOf(listOf(8f, 8f, 85.7f, 85.7f), listOf(8f, 113.9f, 275f, 52.2f), listOf(103.6f, 118.1f, 83.4f, 43.8f)),
        Triple(WidgetTheme.LLAMA, 360, 224) to listOf(listOf(8f, 8f, 135.6f, 135.6f), listOf(8f, 163.8f, 344f, 52.2f), listOf(126.9f, 168f, 106.3f, 43.8f)),
        Triple(WidgetTheme.LLAMA, 360, 420) to listOf(listOf(59.4f, 8f, 241.1f, 241.1f), listOf(8f, 360f, 344f, 52.2f), listOf(126.9f, 364.2f, 106.3f, 43.8f)),
        Triple(WidgetTheme.LLAMA, 360, 640) to listOf(listOf(8f, 76.2f, 344f, 344f), listOf(8f, 552f, 344f, 80f), listOf(126.9f, 556.2f, 106.3f, 71.6f)),
        Triple(WidgetTheme.STANDARD, 276, 90) to listOf(listOf(0f, 0f, 96f, 89.9f), listOf(96f, 44.6f, 144f, 37.3f), listOf(148.2f, 48.8f, 39.6f, 29f)),
        Triple(WidgetTheme.STANDARD, 360, 90) to listOf(listOf(0f, 0f, 89.9f, 89.9f), listOf(97.9f, 45f, 225.9f, 38.9f), listOf(176f, 48f, 69.3f, 32.8f)),
        Triple(WidgetTheme.STANDARD, 291, 174) to listOf(listOf(8f, 8f, 86.5f, 86.5f), listOf(8f, 113.9f, 275f, 52.2f), listOf(103.6f, 118.1f, 83.4f, 43.8f)),
        Triple(WidgetTheme.STANDARD, 360, 224) to listOf(listOf(8f, 8f, 136.8f, 136.8f), listOf(8f, 163.8f, 344f, 52.2f), listOf(126.9f, 168f, 106.3f, 43.8f)),
        Triple(WidgetTheme.STANDARD, 360, 420) to listOf(listOf(56.8f, 8f, 246.1f, 246.1f), listOf(8f, 360f, 344f, 52.2f), listOf(126.9f, 364.2f, 106.3f, 43.8f)),
        Triple(WidgetTheme.STANDARD, 360, 640) to listOf(listOf(8f, 81.1f, 344f, 344f), listOf(8f, 552f, 344f, 80f), listOf(126.9f, 556.2f, 106.3f, 71.6f))
      )
    for ((key, boxes) in expected) {
      val (theme, w, h) = key
      val r = render(theme, w.toFloat(), h.toFloat(), title = "Restore Book A", author = "Test Author")
      assertEquals("$theme ${w}x$h cover", boxes[0], r.boundsDp(R.id.widgetAlbumArt))
      assertEquals("$theme ${w}x$h controls", boxes[1], r.boundsDp(R.id.widgetButtonContainer))
      assertEquals("$theme ${w}x$h play", boxes[2], r.boundsDp(R.id.widgetPlayPauseButton))
    }
  }

  @Test
  fun brandIconTakesNoLayoutSpace() {
    val ids = listOf(R.id.widgetAlbumArt, R.id.widgetReadout, R.id.widgetMediaTitle, R.id.widgetArtistText, R.id.widgetTimeRow, R.id.widgetProgress, R.id.widgetButtonContainer, R.id.widgetPlayPauseButton)
    for (theme in WidgetTheme.values()) for ((w, h) in listOf(276 to 90, 360 to 90, 291 to 174, 360 to 224, 360 to 420, 360 to 640)) {
      val shown = render(theme, w.toFloat(), h.toFloat(), forceIcons = true)
      val hidden = render(theme, w.toFloat(), h.toFloat(), forceIcons = false)
      for (id in ids) assertEquals("$theme ${w}x$h", hidden.boundsDp(id), shown.boundsDp(id))
    }
  }

  @Test
  fun visibleBrandIconNeverOverlapsContent() {
    fun overlap(a: List<Float>, b: List<Float>) = a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
    val content = listOf(R.id.widgetAlbumArt, R.id.widgetMediaTitle, R.id.widgetArtistText, R.id.widgetTimeRow, R.id.widgetButtonContainer)
    for (theme in WidgetTheme.values()) for (font in listOf(1f, 1.3f)) for (w in listOf(250, 291, 360, 480)) for (h in listOf(70, 90, 160, 174, 224, 300, 420, 520, 640)) {
      val r = render(theme, w.toFloat(), h.toFloat(), font)
      for (icon in listOf(R.id.tinyCornerIcon, R.id.tinyCornerIconPanel)) {
        val i = r.boundsDp(icon) ?: continue
        for (id in content) r.boundsDp(id)?.let { assertFalse("$theme ${w}x$h@$font icon overlaps $id", overlap(i, it)) }
      }
    }
  }
}

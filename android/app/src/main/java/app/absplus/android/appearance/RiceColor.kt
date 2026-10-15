package app.absplus.android.appearance

/**
 * RICE color math, the native twin of theme/rice/color.js and contrast.js (docs/rice-customization.md). Colors are
 * IntArray(3) channels 0..255. StrictMath keeps pow() on the same fdlibm algorithm the WebView uses, so the shared
 * mapping fixture (tests/fixtures/rice-device-mapping.json) gives the same channels on both sides.
 */
object RiceColor {
  private fun toLinear(channel: Int): Double {
    val s = channel / 255.0
    return if (s <= 0.04045) s / 12.92 else StrictMath.pow((s + 0.055) / 1.055, 2.4)
  }

  private fun fromLinear(l: Double): Int {
    val s = if (l <= 0.0031308) l * 12.92 else 1.055 * StrictMath.pow(l, 1 / 2.4) - 0.055
    return Math.floor(s * 255 + 0.5).toInt().coerceIn(0, 255)
  }

  fun luminance(c: IntArray): Double = 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2])

  fun contrast(a: IntArray, b: IntArray): Double {
    val la = luminance(a)
    val lb = luminance(b)
    return (maxOf(la, lb) + 0.05) / (minOf(la, lb) + 0.05)
  }

  fun blend(from: IntArray, to: IntArray, t: Double): IntArray =
    IntArray(3) { i -> fromLinear(toLinear(from[i]) + (toLinear(to[i]) - toLinear(from[i])) * t) }

  fun isDark(c: IntArray): Boolean = luminance(c) < 0.18

  private fun sqDistance(a: IntArray, b: IntArray) = (0..2).sumOf { (a[it] - b[it]) * (a[it] - b[it]) }

  private fun lexLess(a: IntArray, b: IntArray): Boolean {
    for (i in 0..2) if (a[i] != b[i]) return a[i] < b[i]
    return false
  }

  data class Constraint(val against: IntArray, val min: Double)

  /** Same search as contrast.js repairColor: least squared change among 256-step blends toward black and white. */
  fun repair(color: IntArray, constraints: List<Constraint>): IntArray {
    fun passes(c: IntArray) = constraints.all { contrast(c, it.against) >= it.min }
    if (passes(color)) return color.copyOf()
    var best: IntArray? = null
    for (target in listOf(BLACK, WHITE)) {
      for (step in 1..256) {
        val candidate = blend(color, target, step / 256.0)
        if (!passes(candidate)) continue
        val b = best
        if (b == null || sqDistance(candidate, color) < sqDistance(b, color) || (sqDistance(candidate, color) == sqDistance(b, color) && lexLess(candidate, b))) best = candidate
        break
      }
    }
    return best ?: color.copyOf()
  }

  fun toArgb(c: IntArray): Int = (0xFF shl 24) or (c[0] shl 16) or (c[1] shl 8) or c[2]

  val WHITE = intArrayOf(255, 255, 255)
  val BLACK = intArrayOf(0, 0, 0)
}

package expo.modules.remiscan

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID
import org.opencv.android.Utils
import org.opencv.android.OpenCVLoader
import org.opencv.core.Core
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc

class RemiScanModule : Module() {
  private data class Detection(
    val rawCorners: List<Double> = emptyList(),
    val corners: List<Double> = emptyList(),
    val score: Double = 0.0,
    val edgeContact: Boolean = false,
    val visualLossRisk: Double = 0.0,
    val issues: List<String> = listOf("boundary_not_found"),
  )

  override fun definition() = ModuleDefinition {
    Name("RemiScan")

    AsyncFunction("detectCorners") { uri: String ->
      require(OpenCVLoader.initLocal()) { "OpenCV is unavailable" }
      detect(loadBitmap(uri)).corners
    }

    AsyncFunction("detectDetailed") { uri: String ->
      require(OpenCVLoader.initLocal()) { "OpenCV is unavailable" }
      val result = detect(loadBitmap(uri))
      mapOf(
        "corners" to result.corners,
        "rawCorners" to result.rawCorners,
        "score" to result.score,
        "edgeContact" to result.edgeContact,
        "visualLossRisk" to result.visualLossRisk,
        "issues" to result.issues,
      )
    }

    AsyncFunction("describeSource") { uri: String ->
      val path = Uri.parse(uri).path ?: throw IllegalArgumentException("Invalid image URI")
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Could not read image" }
      val orientation = try {
        ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      } catch (_: Exception) {
        ExifInterface.ORIENTATION_UNDEFINED
      }
      mapOf("rawWidth" to bounds.outWidth, "rawHeight" to bounds.outHeight, "orientation" to orientation)
    }

    AsyncFunction("sha256") { uri: String ->
      val path = Uri.parse(uri).path ?: throw IllegalArgumentException("Invalid image URI")
      val digest = MessageDigest.getInstance("SHA-256")
      File(path).inputStream().buffered().use { stream ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val size = stream.read(buffer)
          if (size < 0) break
          digest.update(buffer, 0, size)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    AsyncFunction("process") { uri: String, corners: List<Double>, filter: String, rotation: Int ->
      require(OpenCVLoader.initLocal()) { "OpenCV is unavailable" }
      require(filter in listOf("original", "colour", "bw")) { "Unknown filter" }
      require(rotation in listOf(0, 90, 180, 270)) { "Invalid rotation" }
      require(corners.isEmpty() || corners.size == 8) { "Corners must contain four points" }
      val bitmap = loadBitmap(uri)
      var image = Mat()
      Utils.bitmapToMat(bitmap, image)
      val sourceWidth = image.width()
      val sourceHeight = image.height()
      var appliedCorners = emptyList<Double>()
      if (corners.size == 8) {
        require(corners.all { it in 0.0..1.0 }) { "Invalid corners" }
        val points = (0..3).map { Point(corners[it * 2] * image.width(), corners[it * 2 + 1] * image.height()) }.toTypedArray()
        val ordered = order(points)
        appliedCorners = ordered.flatMap { listOf(it.x / sourceWidth, it.y / sourceHeight) }
        fun distance(a: Point, b: Point) = kotlin.math.hypot(a.x - b.x, a.y - b.y)
        val width = kotlin.math.max(distance(ordered[0], ordered[1]), distance(ordered[3], ordered[2])).toInt().coerceAtLeast(1)
        val height = kotlin.math.max(distance(ordered[0], ordered[3]), distance(ordered[1], ordered[2])).toInt().coerceAtLeast(1)
        val sourcePoints = MatOfPoint2f(*ordered)
        val destinationPoints = MatOfPoint2f(Point(0.0, 0.0), Point(width.toDouble(), 0.0), Point(width.toDouble(), height.toDouble()), Point(0.0, height.toDouble()))
        val warped = Mat()
        val transform = Imgproc.getPerspectiveTransform(sourcePoints, destinationPoints)
        Imgproc.warpPerspective(image, warped, transform, Size(width.toDouble(), height.toDouble()))
        transform.release()
        image.release()
        image = warped
        sourcePoints.release()
        destinationPoints.release()
      }
      if (rotation != 0) {
        val rotated = Mat()
        Core.rotate(image, rotated, when (rotation) {
          90 -> Core.ROTATE_90_CLOCKWISE
          180 -> Core.ROTATE_180
          else -> Core.ROTATE_90_COUNTERCLOCKWISE
        })
        image.release()
        image = rotated
      }
      if (filter != "original") {
        val gray = Mat()
        Imgproc.cvtColor(image, gray, Imgproc.COLOR_RGBA2GRAY)
        val enhanced = Mat()
        Imgproc.createCLAHE(2.0, Size(8.0, 8.0)).apply(gray, enhanced)
        gray.release()
        if (filter == "bw") {
          val binary = Mat()
          Imgproc.adaptiveThreshold(enhanced, binary, 255.0, Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C, Imgproc.THRESH_BINARY, 31, 12.0)
          enhanced.release()
          image.release()
          image = binary
        } else {
          val luminance = Mat()
          Imgproc.cvtColor(image, luminance, Imgproc.COLOR_RGBA2RGB)
          Imgproc.cvtColor(luminance, luminance, Imgproc.COLOR_RGB2Lab)
          val lab = mutableListOf<Mat>()
          Core.split(luminance, lab)
          Imgproc.createCLAHE(2.0, Size(8.0, 8.0)).apply(lab[0], lab[0])
          Core.merge(lab, luminance)
          val colour = Mat()
          Imgproc.cvtColor(luminance, colour, Imgproc.COLOR_Lab2RGB)
          Imgproc.cvtColor(colour, colour, Imgproc.COLOR_RGB2RGBA)
          lab.forEach { it.release() }
          enhanced.release()
          luminance.release()
          image.release()
          image = colour
        }
      }
      val output = Bitmap.createBitmap(image.width(), image.height(), Bitmap.Config.ARGB_8888)
      val rgba = Mat()
      if (image.channels() == 1) Imgproc.cvtColor(image, rgba, Imgproc.COLOR_GRAY2RGBA) else image.copyTo(rgba)
      Utils.matToBitmap(rgba, output)
      val file = File(appContext.reactContext?.cacheDir, "remi-${UUID.randomUUID()}.jpg")
      FileOutputStream(file).use { output.compress(Bitmap.CompressFormat.JPEG, 92, it) }
      val result = mapOf(
        "uri" to Uri.fromFile(file).toString(), "width" to output.width, "height" to output.height,
        "sourceWidth" to sourceWidth, "sourceHeight" to sourceHeight,
        "appliedCorners" to appliedCorners, "rotation" to rotation, "filter" to filter,
      )
      rgba.release()
      image.release()
      output.recycle()
      bitmap.recycle()
      result
    }

    AsyncFunction("recognize") { uri: String ->
      val bitmap = loadBitmap(uri)
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try { Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0))).text }
      finally { recognizer.close(); bitmap.recycle() }
    }

    AsyncFunction("recognizeDetailed") { uri: String ->
      val bitmap = loadBitmap(uri)
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try {
        val result = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)))
        mapOf(
          "text" to result.text,
          "lines" to result.textBlocks.flatMap { it.lines }.mapNotNull { line ->
            line.boundingBox?.let { box -> mapOf(
              "text" to line.text,
              "left" to box.left.toDouble() / bitmap.width,
              "top" to box.top.toDouble() / bitmap.height,
              "right" to box.right.toDouble() / bitmap.width,
              "bottom" to box.bottom.toDouble() / bitmap.height,
              "confidence" to line.confidence.toDouble(),
            ) }
          },
        )
      } finally { recognizer.close(); bitmap.recycle() }
    }
  }

  private fun detect(bitmap: Bitmap): Detection {
    val source = Mat()
    val gray = Mat()
    val enhanced = Mat()
    try {
      Utils.bitmapToMat(bitmap, source)
      Imgproc.cvtColor(source, gray, Imgproc.COLOR_RGBA2GRAY)
      Imgproc.GaussianBlur(gray, gray, Size(5.0, 5.0), 0.0)
      Imgproc.createCLAHE(2.0, Size(8.0, 8.0)).apply(gray, enhanced)
      val frameArea = source.width().toDouble() * source.height()
      val background = Core.mean(gray).`val`[0]
      var best: Array<Point>? = null
      var bestScore = 0.0
      for (input in listOf(gray, enhanced)) for (thresholds in listOf(30.0 to 100.0, 55.0 to 150.0, null)) {
        val edges = Mat()
        val hierarchy = Mat()
        val contours = mutableListOf<MatOfPoint>()
        try {
          if (thresholds == null) {
            Imgproc.threshold(input, edges, 0.0, 255.0, Imgproc.THRESH_BINARY or Imgproc.THRESH_OTSU)
            val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(7.0, 7.0))
            try { Imgproc.morphologyEx(edges, edges, Imgproc.MORPH_CLOSE, kernel) }
            finally { kernel.release() }
          } else {
            Imgproc.Canny(input, edges, thresholds.first, thresholds.second)
          }
          Imgproc.findContours(edges, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE)
          for (contour in contours) {
            val contourArea = kotlin.math.abs(Imgproc.contourArea(contour))
            if (contourArea < frameArea * 0.025) continue
            val curve = MatOfPoint2f(*contour.toArray())
            try {
              for (tolerance in listOf(0.02, 0.04)) {
                val polygon = MatOfPoint2f()
                try {
                  Imgproc.approxPolyDP(curve, polygon, Imgproc.arcLength(curve, true) * tolerance, true)
                  if (polygon.total() != 4L) continue
                  val outline = MatOfPoint(*polygon.toArray())
                  try {
                    if (!Imgproc.isContourConvex(outline)) continue
                    val area = kotlin.math.abs(Imgproc.contourArea(outline))
                    if (area < frameArea * 0.025) continue
                    val points = order(outline.toArray())
                    fun distance(a: Point, b: Point) = kotlin.math.hypot(a.x - b.x, a.y - b.y)
                    val width = (distance(points[0], points[1]) + distance(points[3], points[2])) / 2
                    val height = (distance(points[0], points[3]) + distance(points[1], points[2])) / 2
                    if (width < 40 || height < 40) continue
                    val mask = Mat.zeros(gray.size(), gray.type())
                    val brightness = try {
                      Imgproc.fillConvexPoly(mask, outline, org.opencv.core.Scalar(255.0))
                      Core.mean(gray, mask).`val`[0]
                    } finally { mask.release() }
                    val rectangularity = (contourArea / area).coerceIn(0.0, 1.0)
                    val size = (area / (frameArea * 0.35)).coerceIn(0.0, 1.0)
                    val aspect = ((kotlin.math.max(width, height) / kotlin.math.min(width, height) - 1) / 2).coerceIn(0.0, 1.0)
                    val contrast = ((brightness - background) / 60).coerceIn(0.0, 1.0)
                    val score = 0.4 * rectangularity + 0.2 * size + 0.2 * aspect + 0.2 * contrast
                    if (score > bestScore) { best = points; bestScore = score }
                  } finally { outline.release() }
                } finally { polygon.release() }
              }
            } finally { curve.release() }
          }
        } finally {
          contours.forEach { it.release() }
          hierarchy.release()
          edges.release()
        }
      }
      val points = best ?: return if (paperTouchesFrame(gray)) {
        Detection(edgeContact = true, issues = listOf("boundary_not_found", "boundary_touches_frame"))
      } else Detection()
      val raw = points.flatMap { listOf(it.x / bitmap.width, it.y / bitmap.height) }
      val edge = raw.chunked(2).any { it[0] < 0.015 || it[0] > 0.985 || it[1] < 0.015 || it[1] > 0.985 }
      val margin = if (bestScore < 0.7) 0.03 else 0.01
      val centerX = points.sumOf { it.x } / 4
      val centerY = points.sumOf { it.y } / 4
      val width = points.maxOf { it.x } - points.minOf { it.x }
      val height = points.maxOf { it.y } - points.minOf { it.y }
      val visualLossRisk = featureRisk(gray, points, bitmap.width, bitmap.height)
      val expanded = points.flatMap { point ->
        val x = (point.x + kotlin.math.sign(point.x - centerX) * width * margin).coerceIn(0.0, bitmap.width.toDouble())
        val y = (point.y + kotlin.math.sign(point.y - centerY) * height * margin).coerceIn(0.0, bitmap.height.toDouble())
        listOf(x / bitmap.width, y / bitmap.height)
      }
      val issues = buildList {
        if (edge) add("boundary_touches_frame")
        if (bestScore < 0.7) add("uncertain_boundary")
        if (visualLossRisk >= 0.7) add("visual_features_near_crop")
      }
      return Detection(raw, if (edge || bestScore < 0.55 || visualLossRisk >= 0.7) emptyList() else expanded,
        bestScore, edge, visualLossRisk, issues)
    } finally {
      enhanced.release()
      gray.release()
      source.release()
      bitmap.recycle()
    }
  }

  private fun paperTouchesFrame(gray: Mat): Boolean {
    val width = gray.cols()
    val height = gray.rows()
    if (width < 64 || height < 64) return false
    val start = (width * 0.15).toInt()
    val end = (width * 0.85).toInt()
    val step = kotlin.math.max(1, (end - start) / 256)
    val sampleCount = (end - start + step - 1) / step
    val inset = kotlin.math.max(1, (height * 0.015).toInt())

    for ((edgeY, innerY) in listOf(0 to inset, height - 1 to height - 1 - inset)) {
      var run = 0
      var longest = 0
      for (x in start until end step step) {
        val paper = gray.get(edgeY, x)[0] >= 130 && gray.get(innerY, x)[0] >= 130
        run = if (paper) run + 1 else 0
        longest = kotlin.math.max(longest, run)
      }
      val fraction = longest.toDouble() / sampleCount
      if (fraction >= 0.45 && fraction < 0.9) return true
    }
    return false
  }

  private fun featureRisk(gray: Mat, points: Array<Point>, width: Int, height: Int): Double {
    val inner = Mat.zeros(gray.size(), gray.type())
    val outer = Mat.zeros(gray.size(), gray.type())
    val ring = Mat()
    val edges = Mat()
    val nearby = Mat()
    val innerPoints = MatOfPoint(*points)
    val centerX = points.sumOf { it.x } / 4
    val centerY = points.sumOf { it.y } / 4
    val boxWidth = points.maxOf { it.x } - points.minOf { it.x }
    val boxHeight = points.maxOf { it.y } - points.minOf { it.y }
    val outerPoints = MatOfPoint(*points.map { point ->
      Point(
        (point.x + kotlin.math.sign(point.x - centerX) * boxWidth * 0.06).coerceIn(0.0, width.toDouble()),
        (point.y + kotlin.math.sign(point.y - centerY) * boxHeight * 0.06).coerceIn(0.0, height.toDouble()),
      )
    }.toTypedArray())
    try {
      Imgproc.fillConvexPoly(inner, innerPoints, org.opencv.core.Scalar(255.0))
      Imgproc.fillConvexPoly(outer, outerPoints, org.opencv.core.Scalar(255.0))
      Core.subtract(outer, inner, ring)
      val area = Core.countNonZero(ring)
      if (area == 0) return 0.0
      Imgproc.Canny(gray, edges, 45.0, 130.0)
      Core.bitwise_and(edges, ring, nearby)
      return (Core.countNonZero(nearby).toDouble() / area / 0.08).coerceIn(0.0, 1.0)
    } finally {
      inner.release(); outer.release(); ring.release(); edges.release(); nearby.release()
      innerPoints.release(); outerPoints.release()
    }
  }

  private fun loadBitmap(uri: String): Bitmap {
    val path = Uri.parse(uri).path ?: throw IllegalArgumentException("Invalid image URI")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Could not read image" }
    val sample = generateSequence(1) { it * 2 }.first { bounds.outWidth / it <= 3000 && bounds.outHeight / it <= 3000 }
    return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: throw IllegalArgumentException("Could not decode image")
  }

  private fun order(points: Array<Point>): Array<Point> {
    val centerX = points.sumOf { it.x } / points.size
    val centerY = points.sumOf { it.y } / points.size
    val ordered = points.sortedBy { kotlin.math.atan2(it.y - centerY, it.x - centerX) }
    val start = ordered.indices.minBy { ordered[it].x + ordered[it].y }
    return Array(4) { ordered[(start + it) % 4] }
  }
}

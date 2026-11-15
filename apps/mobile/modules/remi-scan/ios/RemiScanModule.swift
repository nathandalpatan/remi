import ExpoModulesCore
import UIKit
import Vision
import CoreImage
import CryptoKit
import ImageIO

public class RemiScanModule: Module {
  private let context = CIContext()

  public func definition() -> ModuleDefinition {
    Name("RemiScan")

    AsyncFunction("detectCorners") { (uri: String) -> [Double] in
      let image = try self.load(uri)
      let result = try self.detect(image)
      return result["corners"] as? [Double] ?? []
    }

    AsyncFunction("detectDetailed") { (uri: String) -> [String: Any] in
      let image = try self.load(uri)
      return try self.detect(image)
    }

    AsyncFunction("describeSource") { (uri: String) -> [String: Int] in
      guard let url = URL(string: uri), url.isFileURL,
            let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
            let width = properties[kCGImagePropertyPixelWidth as String] as? NSNumber,
            let height = properties[kCGImagePropertyPixelHeight as String] as? NSNumber else {
        throw ScanError.invalidInput
      }
      let orientation = (properties[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1
      return ["rawWidth": width.intValue, "rawHeight": height.intValue, "orientation": orientation]
    }

    AsyncFunction("sha256") { (uri: String) -> String in
      guard let url = URL(string: uri), url.isFileURL else { throw ScanError.invalidInput }
      let handle = try FileHandle(forReadingFrom: url)
      defer { try? handle.close() }
      var digest = SHA256()
      while let chunk = try handle.read(upToCount: 64 * 1024), !chunk.isEmpty {
        digest.update(data: chunk)
      }
      return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }

    AsyncFunction("process") { (uri: String, corners: [Double], filter: String, rotation: Int) -> [String: Any] in
      guard ["original", "colour", "bw"].contains(filter), [0, 90, 180, 270].contains(rotation) else {
        throw ScanError.invalidInput
      }
      let image = try self.load(uri)
      var result = CIImage(cgImage: image)
      let sourceWidth = Int(result.extent.width)
      let sourceHeight = Int(result.extent.height)
      guard corners.isEmpty || corners.count == 8 else { throw ScanError.invalidInput }
      if corners.count == 8 {
        guard corners.allSatisfy({ (0.0...1.0).contains($0) }) else { throw ScanError.invalidInput }
        let width = result.extent.width
        let height = result.extent.height
        let points = stride(from: 0, to: 8, by: 2).map { CGPoint(x: corners[$0] * width, y: (1 - corners[$0 + 1]) * height) }
        guard let corrected = CIFilter(name: "CIPerspectiveCorrection", parameters: [
          "inputImage": result,
          "inputTopLeft": CIVector(cgPoint: points[0]),
          "inputTopRight": CIVector(cgPoint: points[1]),
          "inputBottomRight": CIVector(cgPoint: points[2]),
          "inputBottomLeft": CIVector(cgPoint: points[3]),
        ])?.outputImage else { throw ScanError.processingFailed }
        result = corrected
      }
      if rotation != 0 {
        let radians = CGFloat(rotation) * .pi / 180
        result = result.transformed(by: CGAffineTransform(rotationAngle: -radians))
      }
      if filter != "original" {
        result = result.applyingFilter("CIHighlightShadowAdjust", parameters: ["inputShadowAmount": 1.2, "inputHighlightAmount": 1.0])
      }
      if filter == "colour" {
        result = result.applyingFilter("CIColorControls", parameters: ["inputContrast": 1.25, "inputSaturation": 0.9])
      } else if filter == "bw" {
        result = result.applyingFilter("CIPhotoEffectMono")
          .applyingFilter("CIColorControls", parameters: ["inputContrast": 1.5])
      }
      let bounds = result.extent.integral
      guard bounds.width > 0, bounds.height > 0,
            let jpeg = context.jpegRepresentation(of: result, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [.lossyCompressionQuality: 0.92]) else {
        throw ScanError.processingFailed
      }
      let destination = FileManager.default.temporaryDirectory.appendingPathComponent("remi-\(UUID().uuidString).jpg")
      try jpeg.write(to: destination, options: .atomic)
      return [
        "uri": destination.absoluteString, "width": Int(bounds.width), "height": Int(bounds.height),
        "sourceWidth": sourceWidth, "sourceHeight": sourceHeight,
        "appliedCorners": corners, "rotation": rotation, "filter": filter,
      ]
    }

    AsyncFunction("recognize") { (uri: String) -> String in
      let image = try self.load(uri)
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
      return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }

    AsyncFunction("recognizeDetailed") { (uri: String) -> [String: Any] in
      let image = try self.load(uri)
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
      let observations = request.results ?? []
      return [
        "text": observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"),
        "lines": observations.compactMap { observation -> [String: Any]? in
          guard let candidate = observation.topCandidates(1).first else { return nil }
          return [
            "text": candidate.string,
            "left": Double(observation.boundingBox.minX),
            "top": Double(1 - observation.boundingBox.maxY),
            "right": Double(observation.boundingBox.maxX),
            "bottom": Double(1 - observation.boundingBox.minY),
            "confidence": Double(candidate.confidence),
          ]
        },
      ]
    }
  }

  private func detect(_ image: CGImage) throws -> [String: Any] {
    let request = VNDetectRectanglesRequest()
    request.maximumObservations = 12
    request.minimumConfidence = 0.35
    request.minimumAspectRatio = 0.08
    request.minimumSize = 0.08
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let candidates = (request.results ?? []).map { rectangle -> (VNRectangleObservation, Double) in
      let box = rectangle.boundingBox
      let area = Double(box.width * box.height)
      let aspect = Double(max(box.width, box.height) / max(min(box.width, box.height), 0.001))
      let score = 0.55 * Double(rectangle.confidence) + 0.25 * min(area / 0.35, 1) + 0.2 * min(max((aspect - 1) / 2, 0), 1)
      return (rectangle, min(max(score, 0), 1))
    }
    guard let (rectangle, score) = candidates.max(by: { $0.1 < $1.1 }) else {
      return ["corners": [Double](), "rawCorners": [Double](), "score": 0.0,
              "edgeContact": false, "issues": ["boundary_not_found"]]
    }
    let points = [rectangle.topLeft, rectangle.topRight, rectangle.bottomRight, rectangle.bottomLeft]
      .map { CGPoint(x: $0.x, y: 1 - $0.y) }
    let raw = points.flatMap { [Double($0.x), Double($0.y)] }
    let edge = points.contains { $0.x < 0.015 || $0.x > 0.985 || $0.y < 0.015 || $0.y > 0.985 }
    let visualLossRisk = featureRisk(image, points: points)
    let margin = score < 0.7 ? 0.03 : 0.01
    let center = CGPoint(x: points.map(\.x).reduce(0, +) / 4, y: points.map(\.y).reduce(0, +) / 4)
    let width = points.map(\.x).max()! - points.map(\.x).min()!
    let height = points.map(\.y).max()! - points.map(\.y).min()!
    let expanded = points.flatMap { point -> [Double] in
      let x = min(max(point.x + (point.x < center.x ? -1 : 1) * width * margin, 0), 1)
      let y = min(max(point.y + (point.y < center.y ? -1 : 1) * height * margin, 0), 1)
      return [Double(x), Double(y)]
    }
    var issues = [String]()
    if edge { issues.append("boundary_touches_frame") }
    if score < 0.7 { issues.append("uncertain_boundary") }
    if visualLossRisk >= 0.7 { issues.append("visual_features_near_crop") }
    return ["corners": edge || score < 0.55 || visualLossRisk >= 0.7 ? [Double]() : expanded,
            "rawCorners": raw, "score": score, "edgeContact": edge,
            "visualLossRisk": visualLossRisk, "issues": issues]
  }

  private func featureRisk(_ image: CGImage, points: [CGPoint]) -> Double {
    let scale = 512.0 / CGFloat(max(image.width, image.height))
    let width = max(1, Int((CGFloat(image.width) * scale).rounded()))
    let height = max(1, Int((CGFloat(image.height) * scale).rounded()))
    let source = CIImage(cgImage: image).transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let edges = source.applyingFilter("CIEdges", parameters: ["inputIntensity": 1.0])
    guard let edgeImage = context.createCGImage(edges, from: edges.extent) else { return 1 }
    let center = CGPoint(x: points.map(\.x).reduce(0, +) / 4, y: points.map(\.y).reduce(0, +) / 4)
    let boxWidth = points.map(\.x).max()! - points.map(\.x).min()!
    let boxHeight = points.map(\.y).max()! - points.map(\.y).min()!
    let outer = points.map { point in
      CGPoint(
        x: min(max(point.x + (point.x < center.x ? -1 : 1) * boxWidth * 0.06, 0), 1),
        y: min(max(point.y + (point.y < center.y ? -1 : 1) * boxHeight * 0.06, 0), 1)
      )
    }
    func contains(_ quad: [CGPoint], x: CGFloat, y: CGFloat) -> Bool {
      var sign: CGFloat = 0
      for index in 0..<4 {
        let a = quad[index]
        let b = quad[(index + 1) % 4]
        let cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
        if cross == 0 { continue }
        if sign == 0 { sign = cross }
        else if cross * sign < 0 { return false }
      }
      return true
    }
    var pixels = Data(count: width * height * 4)
    return pixels.withUnsafeMutableBytes { (buffer: UnsafeMutableRawBufferPointer) -> Double in
      let info = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
      guard let bitmap = CGContext(data: buffer.baseAddress, width: width, height: height,
                                   bitsPerComponent: 8, bytesPerRow: width * 4,
                                   space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: info) else { return 1 }
      bitmap.translateBy(x: 0, y: CGFloat(height))
      bitmap.scaleBy(x: 1, y: -1)
      bitmap.draw(edgeImage, in: CGRect(x: 0, y: 0, width: width, height: height))
      let bytes = buffer.bindMemory(to: UInt8.self)
      var total = 0
      var features = 0
      for row in 0..<height {
        let y = (CGFloat(row) + 0.5) / CGFloat(height)
        for column in 0..<width {
          let x = (CGFloat(column) + 0.5) / CGFloat(width)
          if !contains(outer, x: x, y: y) || contains(points, x: x, y: y) { continue }
          total += 1
          if bytes[(row * width + column) * 4] > 60 { features += 1 }
        }
      }
      return total == 0 ? 0 : min(Double(features) / Double(total) / 0.08, 1)
    }
  }

  private func load(_ uri: String) throws -> CGImage {
    guard let url = URL(string: uri), url.isFileURL,
          let image = UIImage(contentsOfFile: url.path) else { throw ScanError.invalidInput }
    let scale = min(1, 3000 / max(image.size.width, image.size.height))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: size, format: format)
    let upright = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    guard let cgImage = upright.cgImage else { throw ScanError.invalidInput }
    return cgImage
  }
}

private enum ScanError: Error {
  case invalidInput
  case processingFailed
}

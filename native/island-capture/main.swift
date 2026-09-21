import Foundation
import ScreenCaptureKit
import CoreImage
import CoreMedia

// Capture only the island rectangle and explicitly exclude its window to prevent feedback.
// No audio, cursor, image files, network, or full-display frame transfer.
final class Frames: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let context = CIContext(options: [.cacheIntermediates: false])
    let queue = DispatchQueue(label: "com.jamdeck.island-capture.frames")
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid, let pixel = sample.imageBuffer else { return }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]]
        guard let status = attachments?.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue else { return }
        let image = CIImage(cvPixelBuffer: pixel)
        guard let data = context.jpegRepresentation(of: image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.88]) else { return }
        var length = UInt32(data.count).bigEndian
        var packet = Data(bytes: &length, count: 4)
        packet.append(data)
        FileHandle.standardOutput.write(packet)
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write(Data("Capture stopped: \(error)\n".utf8))
        exit(1)
    }
}

@main struct IslandCapture {
    static func main() async {
        do {
            guard CommandLine.arguments.count == 3,
                  let windowID = UInt32(CommandLine.arguments[1]),
                  let displayID = UInt32(CommandLine.arguments[2]) else { throw NSError(domain: "JamDeckCapture", code: 1) }
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let display = content.displays.first(where: { $0.displayID == displayID }),
                  let island = content.windows.first(where: { $0.windowID == windowID }) else { throw NSError(domain: "JamDeckCaptureTarget", code: 2) }
            let filter = SCContentFilter(display: display, excludingWindows: [island])
            let output = Frames()
            var stream: SCStream?
            FileHandle.standardOutput.write(Data("ready\n".utf8))
            while let line = readLine() {
                if line == "quit" { break }
                if line == "hide" {
                    if let active = stream { try await active.stopCapture(); stream = nil }
                    continue
                }
                let fields = line.split(separator: " ")
                guard fields.count == 5, fields[0] == "show" else { continue }
                let values = fields.dropFirst().compactMap { Double($0) }
                guard values.count == 4, values.allSatisfy({ $0.isFinite }), values[2] > 0, values[3] > 0 else { continue }
                let config = SCStreamConfiguration()
                config.sourceRect = CGRect(x: values[0] - display.frame.origin.x, y: values[1] - display.frame.origin.y, width: values[2], height: values[3])
                config.width = Int(values[2].rounded())
                config.height = Int(values[3].rounded())
                config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
                config.queueDepth = 3
                config.showsCursor = false
                config.capturesAudio = false
                config.pixelFormat = kCVPixelFormatType_32BGRA
                if let active = stream { try await active.updateConfiguration(config) }
                else {
                    let active = SCStream(filter: filter, configuration: config, delegate: output)
                    try active.addStreamOutput(output, type: .screen, sampleHandlerQueue: output.queue)
                    try await active.startCapture()
                    stream = active
                }
            }
            if let active = stream { try await active.stopCapture() }
        } catch {
            FileHandle.standardError.write(Data("Desktop capture needs Screen Recording permission: \(error)\n".utf8))
            exit(1)
        }
    }
}

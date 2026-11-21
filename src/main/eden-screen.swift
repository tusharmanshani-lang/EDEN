import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

@main
struct EdenScreen {
    static func emit(_ value: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        FileHandle.standardOutput.write(data)
    }

    static func normalize(_ value: String) -> String {
        value.lowercased().filter {
            $0.isLetter || $0.isNumber || $0 == "."
        }
    }

    static func orderedWindowIDs(pid: pid_t) -> [CGWindowID] {
        guard let windows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else {
            return []
        }

        return windows.compactMap { window in
            guard
                (window[kCGWindowOwnerPID as String] as? NSNumber)?
                    .int32Value == pid,
                (window[kCGWindowLayer as String] as? NSNumber)?
                    .intValue == 0,
                let id = window[kCGWindowNumber as String] as? NSNumber
            else {
                return nil
            }

            return id.uint32Value
        }
    }

    @available(macOS 14.0, *)
    static func selectWindow(
        content: SCShareableContent,
        pid: pid_t,
        bundle: String
    ) -> SCWindow? {
        let candidates = content.windows.filter { window in
            window.owningApplication?.processID == pid &&
            window.owningApplication?.bundleIdentifier == bundle &&
            window.isOnScreen &&
            window.windowLayer == 0 &&
            window.frame.width >= 80 &&
            window.frame.height >= 60
        }

        for id in orderedWindowIDs(pid: pid) {
            if let window = candidates.first(where: { $0.windowID == id }) {
                return window
            }
        }

        return nil
    }

    @MainActor
    static func main() async {
        do {
            guard #available(macOS 14.0, *) else {
                try emit(["state": "requires-macos-14"])
                return
            }

            let blockedJSON = CommandLine.arguments.dropFirst().first ?? "[]"
            let blocked = try JSONDecoder().decode(
                [String].self,
                from: Data(blockedJSON.utf8)
            )
            let names = Set(blocked.map(normalize))

            guard CGPreflightScreenCaptureAccess() else {
                _ = CGRequestScreenCaptureAccess()
                try emit(["state": "permission"])
                return
            }

            guard
                let front = NSWorkspace.shared.frontmostApplication,
                let bundle = front.bundleIdentifier,
                let name = front.localizedName
            else {
                try emit(["state": "unavailable"])
                return
            }

            if names.contains(normalize(name)) ||
                names.contains(normalize(bundle)) {
                try emit(["state": "private"])
                return
            }

            let pid = front.processIdentifier
            let content = try await SCShareableContent.excludingDesktopWindows(
                true,
                onScreenWindowsOnly: true
            )

            guard
                NSWorkspace.shared.frontmostApplication?
                    .processIdentifier == pid,
                let window = selectWindow(
                    content: content,
                    pid: pid,
                    bundle: bundle
                )
            else {
                try emit(["state": "unavailable"])
                return
            }

            let id = window.windowID
            let configuration = SCStreamConfiguration()
            let scale = min(
                1.0,
                1280.0 / max(window.frame.width, window.frame.height)
            )

            configuration.width = max(1, Int(window.frame.width * scale))
            configuration.height = max(1, Int(window.frame.height * scale))
            configuration.showsCursor = false

            let image = try await SCScreenshotManager.captureImage(
                contentFilter: SCContentFilter(
                    desktopIndependentWindow: window
                ),
                configuration: configuration
            )

            guard
                NSWorkspace.shared.frontmostApplication?
                    .processIdentifier == pid,
                selectWindow(
                    content: content,
                    pid: pid,
                    bundle: bundle
                )?.windowID == id
            else {
                try emit(["state": "unavailable"])
                return
            }

            guard let jpeg = NSBitmapImageRep(cgImage: image).representation(
                using: .jpeg,
                properties: [.compressionFactor: 0.65]
            ) else {
                try emit(["state": "capture-error"])
                return
            }

            try emit([
                "state": "ready",
                "target": "\(bundle):\(pid):\(id)",
                "data": jpeg.base64EncodedString()
            ])
        } catch {
            FileHandle.standardError.write(
                Data((error.localizedDescription + "\n").utf8)
            )
            try? emit(["state": "capture-error"])
        }
    }
}
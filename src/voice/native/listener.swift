import AVFoundation
import Foundation
import Speech

func emit(_ kind: String, _ text: String = "") {
    let data = try! JSONSerialization.data(withJSONObject: ["kind": kind, "text": text])
    print(String(decoding: data, as: UTF8.self))
    fflush(stdout)
}

final class Listener {
    let engine = AVAudioEngine()
    let recognizer: SFSpeechRecognizer
    var task: SFSpeechRecognitionTask?
    var pending: DispatchWorkItem?
    var generation = 0
    var tapped = false
    var latest = ""
    var failures = 0

    init(_ recognizer: SFSpeechRecognizer) { self.recognizer = recognizer }

    func start() {
        generation += 1
        let current = generation
        pending?.cancel()
        task?.cancel()
        engine.stop()
        let input = engine.inputNode
        if tapped { input.removeTap(onBus: 0); tapped = false }
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            emit("error", "No microphone input format is available.")
            exit(1)
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.contextualStrings = ["Hey Eden", "Hi Eden", "Spotify"]
        latest = ""
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        tapped = true
        do { try engine.start() } catch {
            emit("error", error.localizedDescription)
            exit(1)
        }
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, self.generation == current else { return }
                let text = result?.bestTranscription.formattedString ?? ""
                if !text.isEmpty {
                    self.failures = 0
                    if text != self.latest || result?.isFinal == true {
                        self.latest = text
                        self.pending?.cancel()
                        let work = DispatchWorkItem { [weak self] in
                            guard let self = self, self.generation == current else { return }
                            emit("transcript", text)
                            self.start()
                        }
                        self.pending = work
                        DispatchQueue.main.asyncAfter(deadline: .now() + (result?.isFinal == true ? 0 : 1.2), execute: work)
                    }
                } else if let error = error, self.latest.isEmpty {
                    self.failures += 1
                    let nsError = error as NSError
                    if self.failures >= 3 && !(nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 1110) {
                        emit("error", error.localizedDescription)
                        exit(1)
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                        if self.generation == current { self.start() }
                    }
                }
            }
        }
    }
}

var listener: Listener?
if CommandLine.arguments.count == 3 {
    let sessionFile = CommandLine.arguments[1]
    let owner = Int32(CommandLine.arguments[2]) ?? 0

    _ = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
        if !FileManager.default.fileExists(atPath: sessionFile)
            || owner <= 0 || kill(owner, 0) != 0 {
            exit(0)
        }
    }
}
SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else {
        emit("error", "Allow Speech Recognition for EDEN in Privacy & Security.")
        exit(1)
    }
    AVCaptureDevice.requestAccess(for: .audio) { allowed in
        DispatchQueue.main.async {
            guard allowed else { emit("error", "Microphone access was denied."); exit(1) }
            let recognizer = ["en-IN", "en-US", "en-GB"].compactMap {
                SFSpeechRecognizer(locale: Locale(identifier: $0))
            }.first { $0.isAvailable && $0.supportsOnDeviceRecognition }
            guard let recognizer = recognizer else {
                emit("error", "No supported on-device English speech recognizer is available.")
                exit(1)
            }
            listener = Listener(recognizer)
            listener?.start()
            emit("ready")
        }
    }
}
RunLoop.main.run()

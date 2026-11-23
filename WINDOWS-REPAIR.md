# Windows recovery preview 0.2.1

Patch identifier: windows-recovery-1. This is an experimental repair, not a verified production release or a signing solution.

## Startup

The interface is created before conversation-engine initialization. A second launch restores a minimized main window or brings an existing setup window forward. Windows does not honor the Mac-only background-launch switch. Renderer load failures, renderer termination and startup exceptions report a visible error instead of silently leaving a hidden process. Chat requests during initialization receive a starting message. These changes address plausible causes of the tester's hidden-window symptom; they do not establish a verified root cause on that laptop.

## Windows voice input

The legacy System.Speech recognizer is no longer started by default on Windows. Do not lower its confidence threshold: the tester's transcripts were incorrect. Hands-free Hey EDEN activation is NOT implemented by this repair. Mac native voice input is unchanged.

Click Record voice, consent to sending a microphone clip to Google Gemini, speak, and click Finish recording. Capture stops at 15 seconds. Review the transcript in the composer before pressing Send. No audio transcript is automatically executed. If there is an existing draft, it is preserved and the transcript is shown separately below it. A compatible audio-capable model and quota are required; if unavailable, type instead. Accuracy and Hindi/English quality must be tested on Windows. Clips are not intentionally saved to disk by EDEN, but Google processes submitted audio under its terms. Cancellation cannot retract content already sent to Google.

Alternatively focus the message field and press Windows+H to use Microsoft's separate voice-typing service. Internet, Windows speech settings and microphone permissions may be required. Use the service only if you accept Microsoft's privacy terms.

## Speech output

Windows speech uses a fixed inline PowerShell command with reply text through stdin, rather than loading an unsigned .ps1 file. No execution-policy flags, permanent policy changes, registry edits or Smart App Control changes are made. Managed policies can still restrict .NET speech; such errors should leave typed chat usable. This does not add a trusted publisher signature.

## Build and test

Apply from your existing EDEN-WINDOWS checkout using the included install.py, then run npm ci, npm run check:windows and npm run build:renderer. Commit only the repair files and push windows-preview to trigger the existing Windows workflow. The installer version is bumped to 0.2.1 to distinguish it from the previous test.

Install the resulting 0.2.1 build on the tester's laptop after quitting the old app. Test: cold launch, repeat launch, minimized window recovery, offline launch, typed chat, spoken replies, microphone denied, record/cancel, transcript review, quota unavailable, forms and outfits. Windows runtime, microphone quality and signing remain unverified until these tests run. Existing unsupported screen capture, advanced window/music controls and reminders are not added here.

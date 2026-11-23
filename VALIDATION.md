# Windows preview validation — 23 November 2026

## Passed here

- Clean npm ci: 359 dependencies installed.
- Syntax checks: 56 JavaScript files, including renderer bundles.
- Avatar and energy renderer bundles rebuilt with esbuild.
- Windows adapter tests: HTTP/HTTPS opening, unsafe URL rejection, app allowlist rejection, unsupported playback reporting.
- Voice lifecycle tests with a mocked Windows child process: ready, command delivery, stop, restart, cancelled startup and error reporting.
- Actual temporary-folder tests using the inherited file controller: read TXT, reject paths outside approved roots, reject symlink escape.
- Windows x64 unpacked Electron application packaging.
- Inspected final package: Windows PDF native dependency included, Linux canvas binaries removed, Apple native helper files removed.

## Fixed during this review

- Setup closing its window could quit the app before the main window opened.
- Listener startup cancellation could leave a pending promise or report an intentional stop as a failure.
- Windows app aliases were still inherited from the Mac allowlist.
- Windows speech stdin needed explicit UTF-8 decoding.
- Platform-specific file exclusions alone did not remove Apple helpers: added an after-pack hook.
- Cross-platform packaging originally selected Linux PDF binaries: added a required Windows-native dependency check.

## Not passed / not tested

- NSIS installer attempt on this Linux host stopped with `spawn wine ENOENT`. No working installer was produced or tested here.
- No Windows desktop runtime, microphone, installed speech engine, secure storage, GPU render, real Gemini response, or installer launch was tested.
- PowerShell parser and System.Speech checks are included in the Windows GitHub workflow but have not run here.
- macOS runtime regression was not tested.
- No claim that every feature works: screen capture, reminders, advanced browser/window/music controls and Windows coding tools remain unsupported as listed in WINDOWS-START-HERE.md.

The source archive contains no node_modules or build output. Build the installer with the included manual GitHub Windows workflow, then test on your friend's laptop before a public Windows release.

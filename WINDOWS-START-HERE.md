# EDEN for Windows — first developer preview

This is a separate Windows adaptation of your uploaded EDEN-PUBLIC source. It also retains the existing macOS paths. No Windows runtime test has been completed here. A Windows application directory can be packaged here, but making the NSIS installer on this Linux host requires Wine; use the included Windows GitHub workflow. Do not replace the published Mac release with this ZIP.

## Run on a Windows PC

1. Extract this source ZIP to a new folder, such as Documents/EDEN-WINDOWS.
2. Install Node.js 22 LTS for Windows.
3. Open Terminal in that folder and run:

```powershell
npm ci
npm run check:windows
npm run dev
```

4. Enter your name and your own Gemini API key in EDEN's setup window. The key is encrypted using Electron secure storage, separately on each computer. Existing Mac credentials are not copied.
5. For voice, allow **Settings → Privacy & security → Microphone → Let desktop apps access your microphone**. Install an English speech recognition language if needed. This uses Windows PowerShell 5.1 and System.Speech, not PowerShell 7. Managed computers can block scripts; keyboard chat remains available.
6. Say **Hey Eden, open calculator**. After wake-up, follow-up speech stays active. Say **go to sleep** to end that voice conversation. Say **stop** or use Stop to interrupt. The voice is an installed Windows voice, not macOS Tara. Recognition accuracy depends on the installed engine, language and microphone. Headphones reduce feedback.

## What is included

| Feature | Windows preview status |
| --- | --- |
| Gemini conversation and personal memory | Existing implementation retained; needs runtime test |
| Per-user first-run name/API-key setup | Adapted for Windows secure storage |
| Human VRM, energy form, expressions | Existing renderer retained |
| Original/reactor outfits and nanotech transitions | Existing renderer retained |
| Generated gestures | Existing implementation retained; requires Gemini quota |
| Spoken replies | New Windows installed-voice adapter; needs Windows test |
| Hey Eden voice commands | New English System.Speech adapter; needs Windows test |
| Approved-folder browsing, file search and text reading | Existing implementation reused with Windows folders |
| PDF/DOCX document reading and research reports | Existing workers retained; needs Windows dependency test |
| Open websites | Windows default browser |
| Open apps | Allowlisted installed apps; some must be on PATH |
| Screen viewing | Not implemented; capture does not start |
| Split screen/browser window automation | Not implemented |
| Spotify/YouTube playback automation | Not implemented; websites can still open |
| Volume, shutdown and other power controls | Not implemented |
| Apple Calendar/Reminders integration | Not implemented |
| RTF conversion | Not implemented; use TXT/DOCX |
| Coding agent, deployment/build tools | Existing Mac-oriented code retained; not supported/tested on Windows |
| Gmail and dedicated Daily Brief/news modules | Not present in the uploaded PUBLIC source; not added from your personal NEXT project |
| Imported dances, songs and VRMA clips | Excluded as requested for the public version |

## Make a Windows installer

On Windows, after testing:

```powershell
npm run pack:win
```

The x64 Setup EXE appears in `release-public`. This is unsigned. Do not describe it as signed, trusted or production ready. It targets x64 Windows; ARM64 Windows has not been tested.

Alternatively upload this reviewed source to a new branch in your existing repository, including `.github/workflows/windows-preview.yml`. In GitHub open **Actions → Build Windows preview → Run workflow**. Download the `EDEN-Windows-x64-preview` artifact once the build succeeds. The workflow builds only; it does not publish a release automatically. No API key is needed in GitHub Actions. Do not upload your personal credentials to GitHub.

## Test before sharing

- Launch from installed EXE; complete setup; quit and reopen; confirm saved setup works.
- Type a question, hear the reply, and interrupt playback with Stop.
- Test Hey Eden and a follow-up command; test microphone denied and missing speech language.
- Open calculator and a website; reject a non-HTTP website.
- Search/read a test TXT/DOCX/PDF within Documents; verify a file outside approved roots is refused.
- Show human/energy forms; switch outfits both ways; test generated motion with valid quota.
- Ask for screen viewing, split screen and reminders; confirm clear unsupported messages.
- Regression-test the Mac build before replacing its release.

## Validation performed here

All source JavaScript syntax checks, graphics bundle builds, dependency installation, mocked Windows adapter/voice lifecycle tests, and real approved-folder file-access tests. The mock checks cover website protocol/credential rejection, app allowlist rejection, unsupported playback reporting and wake/sleep command parsing. They do not validate Windows speech, GPU rendering, the NSIS installer or a complete Electron session. See VALIDATION.md for results and limitations.

Original upload was left untouched. The copy excludes node_modules, .git, backups, private-data folders, old builds, .env files, Apple metadata, imported performances and songs. Existing Apple native helpers remain in the source for macOS; the Windows packaging configuration excludes them.

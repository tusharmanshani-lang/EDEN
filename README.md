# EDEN

A voice-first AI companion and Mac assistant built with Electron.

**Status:** Experimental. Currently configured to package for Apple Silicon Macs. Intel support has not been verified.

## Features

- Gemini-powered conversation with local conversation history
- Voice commands and interruptible spoken replies
- Mac app and window controls
- Screen Awareness, enabled explicitly by the user
- Apple Reminders and Calendar integration
- Energy-core and VRM avatar forms
- Outfit switching and generated avatar movements
- Project and coding tools, with separate setup requirements

Feature availability depends on permissions, model access, installed tools, and configuration. Imported dances, songs, and preset animation files are not included.

## Run from source

1. Install Node.js LTS and npm.
2. Download or clone this repository.
3. Open Terminal in the project folder.
4. Run:

   npm install
   npm run dev

Some native helpers require Apple's Command Line Tools.

## First launch

Enter your name and your own Gemini API key.

Create a key at:
https://aistudio.google.com/apikey

EDEN automatically discovers and tests a compatible chat model. Advanced settings allow an optional model override.

Google controls availability, pricing, and quotas. Free access is not guaranteed or unlimited. Setup may send up to three small test requests.

## Permissions

Enable permissions as you use the relevant features:

- Microphone and Speech Recognition: voice input
- Screen Recording: Screen Awareness
- Accessibility and Automation: supported Mac controls
- Calendars and Reminders: requested scheduling operations
- Files and Folders: protected locations you choose to access

Screen Awareness must be started explicitly. Say "Start watching" to enable it and "Stop watching" to stop it.

Some features may require additional configuration or compatible Gemini models.

## Privacy

The public version stores its account and local data separately in:

~/Library/Application Support/eden-public

The API key is encrypted locally using Electron's macOS secure storage. It is decrypted in the app process when needed.

Conversation prompts and relevant context are sent to Google when cloud features are used. Screen content is sent when Screen Awareness is active. Requested coding operations may use separately configured services.

Do not commit API keys, account.enc, .env files, memories, reports, or private project files.

## Development and builds

Run the development app:

npm run dev

Build an Apple Silicon application:

npm run pack

Build output is written to release-public.

The current packaging configuration uses ad-hoc signing. Developer ID signing, notarization, and clean-machine installation testing remain release tasks.

## Assets and distribution

Bundled VRM model sources and redistribution permissions have not yet been verified. Do not redistribute those assets until their permissions are confirmed.

Songs, imported dances, and preset animation assets are excluded from Git and public builds.

Project-authored code and documentation use the MIT License. Third-party dependencies retain their respective licenses; see LICENSING.md for asset limitations.

## Limitations

This is an experimental Mac operator. Verify important action results. Native helpers, voice availability, coding tools, and screen features require further testing on other Macs.

## License

Project-authored software and documentation are licensed under the [MIT License](LICENSE). See [Licensing scope and asset audit](LICENSING.md) for third-party components and non-code assets. Bundled assets are not automatically covered by the software license.

## Privacy policy

See [EDEN privacy policy](PRIVACY.md) before connecting an AI account or enabling voice, screen or project features.

## Code signing policy

See [Code signing policy](CODE_SIGNING.md). SignPath approval/signing is not yet confirmed. Current Windows downloads are unsigned experimental previews; the existing Mac download is ad-hoc signed and not notarized. Windows voice recognition and startup have unresolved tester reports. Build success does not establish runtime reliability.

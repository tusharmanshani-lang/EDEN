# EDEN privacy policy

Updated: 24 November 2026

This policy describes EDEN's public macOS preview and experimental Windows port. Personal development copies and optional third-party integrations may behave differently. Maintainer: Tushar Manshani, https://github.com/tusharmanshani-lang. For non-sensitive privacy questions, contact the maintainer through the repository; never post credentials, private conversations, documents or screenshots in a public issue.

## Local information

EDEN stores the setup name, account configuration, conversation history, saved personal memories, settings and feature-related files on your computer. The public app uses the `eden-public` folder under macOS Application Support or Windows AppData/Roaming. Browser-based UI settings may also be stored in the app's local browser storage. User-requested reports or project outputs can be saved separately, such as in Documents/EDEN Reports or chosen workspaces.

The Gemini API key is encrypted at rest with Electron safeStorage when available and decrypted in the app process for requests. Conversation history, memories, reports and logs are not all encrypted by EDEN. Operating-system account and device protection still matter.

## Google Gemini and network access

Connecting your own Gemini account enables requests to Google. Setup tests model access, and startup greetings may make a request automatically. Conversation features send prompts, recent conversation history and selected relevant memories or task context to Google. The API key authenticates those requests. Generated gestures also use Gemini. Google Search grounding, when invoked, uses Google's search service. Quotas, retention, processing, pricing and model-training treatment depend on Google's current service terms and your account; this policy does not promise that Google retains nothing.

When a supported workflow incorporates selected files, project details or screen content into an AI prompt, that context can leave your computer. Local file tools can read approved folders for requested tasks. Avoid requesting cloud analysis of information you do not want sent to the configured provider.

Google policies: https://policies.google.com/privacy and https://ai.google.dev/gemini-api/terms.

## Microphone and screen

The included voice adapters use operating-system speech recognition. Recognized command text may be sent to Gemini when it becomes a cloud request. These adapters are not intended to upload raw microphone recordings directly to the maintainer. Operating-system speech/privacy settings and the installed recognition engine also apply. Voice listening can start with the app and may remain active for follow-up commands; close EDEN completely and revoke microphone permission to stop microphone access. Hiding the Mac window is not the same as quitting.

Screen Awareness in the macOS implementation requires an explicit start request and relevant permission. While active, captured window images and screen questions are transmitted to Google Gemini Live. Use Stop watching to stop capture; use the supported privacy block list for sensitive apps. Windows screen capture is not implemented in this preview. Do not assume all versions have identical privacy controls.

Apple privacy: https://www.apple.com/legal/privacy/ ; Microsoft privacy: https://privacy.microsoft.com/privacystatement.

## Websites, media and developer tools

Opening a website sends you to that third-party service. Search terms may appear in the destination URL. Music lookup may send a song query to Apple's search API. Requested coding and project workflows can invoke separately installed agents, package managers and hosting services; selected workspace content, prompts or files may then be processed by their providers. Review each service's terms before enabling it. Local mode restricts supported cloud actions but is not a network firewall; it does not replace operating-system controls.

## Maintainer access and diagnostics

The reviewed public source does not include a dedicated maintainer-run analytics or automatic crash-reporting endpoint. This does not mean there is no network activity: Google, third-party websites, developer tools, operating-system services and GitHub downloads have their own processing. Diagnostic logs may contain task content or errors. If you send logs or screenshots for support, redact private information first.

## Retention, deletion and choices

Local history and memories persist until removed. To reset the public app completely, quit it and back up any data you need, then remove its `eden-public` application-data folder. Separately remove exported reports, chosen workspaces and files elsewhere if desired. Uninstalling the app may leave this data behind. Removing local files does not delete copies already held by external providers. Revoke an API key through Google AI Studio if necessary.

You can decline setup, avoid cloud features, quit the app, revoke operating-system permissions or uninstall it. This project has no verified compliance certification; policy changes should be reviewed alongside the corresponding release.

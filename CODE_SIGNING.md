# Code signing policy

Updated: 24 November 2026

## Current status

SignPath Foundation signing is being considered/requested. Approval, a production certificate and a signing integration have not been confirmed. Existing Windows preview installers are unsigned; the existing macOS preview uses ad-hoc signing and is not Apple-notarized. Neither GitHub build success nor this policy verifies an application as safe. Do not disable system protections to install a preview.

If accepted and configured, the project will display the required acknowledgment: “Free code signing provided by SignPath.io, certificate by SignPath Foundation.” This statement describes intended attribution, not current sponsorship or certification.

## Responsibility

- Author/committer: Tushar Manshani (@tusharmanshani-lang).
- Reviewer: Tushar Manshani; external contributions require review before acceptance.
- Release/signing approver: Tushar Manshani. Each future production signing request requires manual release approval.

This is currently a single-maintainer project, not independent two-person review. Repository and signing accounts must use multifactor authentication before production signing is enabled; this document does not claim that account settings have been verified.

## Release process

Windows builds are produced from source through the repository's GitHub Actions workflow. A release must identify its source commit and build run. Before signing or publication, the maintainer reviews source and build changes, dependency/asset rights, privacy disclosures, automated checks, intended platform, known limitations and runtime tests. Signing credentials must not be committed to the repository. Apply least-privilege workflow permissions and restrict production signing to approved release commits.

Sign only project-owned artifacts within the provider's permitted configuration. Retain upstream signatures and license notices; do not misrepresent third-party binaries as EDEN-authored code. Required signing coverage includes application executables, installers and script/native components as applicable to platform policy. Apple signing/notarization is a separate process.

## Privacy and reports

See [Privacy policy](PRIVACY.md). Network-enabled features can send user content to configured providers; this project does not claim that it is entirely offline. Report a suspect release to the maintainer through the repository without publishing private user data. A suspect artifact should be withdrawn while investigated, and the signing provider contacted where applicable.

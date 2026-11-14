---
title: Desktop Releases
summary: Build desktop releases and publish authenticated macOS updates with Sparkle.
---

# Desktop Releases

## Overview

The desktop app bundles the web interface. Publishing a website update does not change installed desktop copies; publish a desktop release to deliver the new interface too.

macOS uses Sparkle to check a public HTTPS appcast, verify the update archive, and install it. Windows uses electron-updater and its existing GitHub release metadata. Both platforms download full desktop releases from the repository configured in `config/desktop-release.json`.

Sparkle authenticates Mac updates with an Ed25519 key pair. The public key ships in the app; the private key signs release archives and must stay private. This works with ad-hoc app signing and does not require an Apple Developer ID subscription. It does not remove macOS restrictions on the initial installation. Mac builds require macOS 14 or later because of the bundled native bridge.

## Signing configuration

The standard release workflow uses the public key in `config/desktop-sparkle.json` and the repository Actions secret `SPARKLE_ED_PRIVATE_KEY`. The private key must be Sparkle's base64-encoded 32-byte seed. The workflow refuses to sign with a key that does not match the public key embedded in the app.

If you distribute your own desktop builds, generate your own key after installing dependencies:

```bash
npx --no-install electron-sparkle generate-keys --account your-desktop-app
npx --no-install electron-sparkle generate-keys --account your-desktop-app -x /secure/location/sparkle-private-key
```

Put the printed public key in `config/desktop-sparkle.json`, or set `MEOWBERT_SPARKLE_PUBLIC_KEY` consistently when packaging and generating the appcast. Store the exported private seed in your source repository's `SPARKLE_ED_PRIVATE_KEY` Actions secret and retain a secure backup. Never commit it. The export is sensitive; remove the temporary file after saving it securely. The original key remains in the macOS Keychain under the account you specified.

Keep using the same key for future updates. Replacing only the public key breaks verification for existing installations. Follow Sparkle's key migration process if rotation is necessary.

## Publishing

To publish from the terminal, install GitHub CLI (`brew install gh` on macOS), authenticate with `gh auth login`, and run:

```bash
bash scripts/publish_release.sh
```

Start from a clean `main` checkout with your changes committed. The script suggests the next version and shows the release repository, tag, and any unpushed commits. After you confirm, it updates and commits the package and lockfile versions, pushes `main` and the release tag, follows the GitHub Actions build, and verifies the published Mac and Windows downloads and Sparkle appcast. You need Git, Node.js, curl, and permission to push to the source repository. Signing secrets stay in GitHub Actions; no local packaging or signing setup is needed.

If the workflow fails after the tag is pushed, use the printed workflow details to fix or rerun that release. The script refuses to reuse an existing tag. It does not edit `CHANGELOG.md` or release notes.

Use the **Desktop Release** GitHub Actions workflow with a tag matching the version in `apps/desktop/package.json`, such as `desktop-v2026.11.4`. The alternate form `desktop-2026.11.4` is also supported; archives and the appcast use the tag you supply. Cross-repository publishing also needs the existing `DESKTOP_RELEASES_GH_TOKEN` secret.

The macOS job packages a universal app, signs its ZIP with Sparkle's official tooling, and generates a signed `appcast.xml`. It uploads the appcast after the release archives. Installed apps read `https://github.com/<owner>/<repo>/releases/latest/download/appcast.xml`; the feed references the ZIP under its exact release tag. Stable installations follow GitHub's latest stable release.

With **build_only** enabled, the workflow includes the appcast in its downloadable artifacts instead of publishing it. When publishing those artifacts manually, upload the matching ZIP and appcast to the same release tag before making that release latest. Do not modify a signed ZIP or appcast after generation.

For a local universal Mac package, use the same packaging workflow and then generate its feed:

```bash
npm run package --workspace apps/desktop -- --mac zip --universal --publish never
RELEASE_TAG=desktop-v2026.11.4 node apps/desktop/scripts/sparkle-appcast.mjs
```

Set `SPARKLE_ED_PRIVATE_KEY` securely in the process environment for the second command. Keep the version and tag consistent with your release. The script writes `apps/desktop/dist-packages/appcast.xml` and verifies its signature before returning.

## Verification and migration

The packaging integration installs Sparkle before electron-builder signs the app. Do not modify or manually re-sign a completed bundle. The release workflow checks the packaged runtime; you can also inspect a local bundle with:

```bash
npx --no-install electron-sparkle doctor --app apps/desktop/dist-packages/mac-universal/Meowbert.app
```

Before distributing an update, test two packaged versions against a staging HTTPS appcast. Confirm the older app verifies and installs the newer archive, relaunches with the new version, and then reports no update. Confirm local execution shuts down before relaunch. Package validation alone does not prove the complete update flow.

Mac builds released before Sparkle was integrated cannot discover this feed. Users must install a Sparkle-enabled release manually once. Windows keeps its existing update path.

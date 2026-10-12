# Releasing Lyra

A tag such as `v0.2.0` builds signed installers for macOS, Windows and Linux, uploads them to a draft GitHub release, and publishes it once every build has succeeded. Installed copies of Lyra then find the update on their own.

## What a release contains

| Platform | Download | Updates itself from |
|---|---|---|
| macOS (Apple Silicon and Intel) | `Lyra-macos-universal.dmg`, signed and notarized | `Lyra-macos-universal.app.tar.gz` |
| Windows x64 | `Lyra-windows-x64-setup.exe` (also `.msi`), not signed yet | the setup `.exe` |
| Linux x64 | `Lyra-linux-amd64.AppImage`, `.deb`, `Lyra-linux-x86_64.rpm` | the same file type that was installed |

The file names never change between versions, so `https://github.com/eisewilliam/project-lyra/releases/latest/download/<name>` always points at the newest release. The website links to those addresses.

`latest.json` lists each platform's update file and signature. The app reads it from `releases/latest/download/latest.json`. GitHub's "latest" skips drafts and pre-releases, so nobody is offered an update before it is published.

## One-time setup

Everything below goes into the repository's Actions secrets: **Settings → Secrets and variables → Actions → New repository secret**. You can also use `gh secret set NAME`, which reads the value from standard input. Secrets are never printed in workflow logs.

### 1. Developer ID certificate (macOS signing)

1. In Xcode, open **Settings → Accounts**, select your team, then **Manage Certificates… → + → Developer ID Application**. Only the team's Account Holder can create one.
2. In Keychain Access, find **Developer ID Application: *Your Name* (*TEAMID*)** under **My Certificates**. Right-click it and choose **Export…**, save it as `.p12`, and set a password.
3. Add the secrets:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | The `.p12` file, base64-encoded: `base64 -i DeveloperID.p12 \| gh secret set APPLE_CERTIFICATE` |
| `APPLE_CERTIFICATE_PASSWORD` | The export password |
| `APPLE_SIGNING_IDENTITY` | The quoted name printed by `security find-identity -v -p codesigning`, for example `Developer ID Application: Jane Doe (AB12CD34EF)` |

### 2. App Store Connect API key (notarization)

1. In App Store Connect, open **Users and Access → Integrations → App Store Connect API → Team Keys**, and generate a key with **Developer** access.
2. Download `AuthKey_<KEYID>.p8`. Apple only lets you download it once, so keep it somewhere safe.
3. Add the secrets:

| Secret | Value |
|---|---|
| `APPLE_API_KEY` | The key ID |
| `APPLE_API_ISSUER` | The issuer ID shown above the key list |
| `APPLE_API_PRIVATE_KEY` | The whole `.p8` file: `gh secret set APPLE_API_PRIVATE_KEY < AuthKey_<KEYID>.p8` |

### 3. Updater signing key

Every update is signed, and the app installs an update only if its signature matches the public key built into it.

```bash
cd apps/desktop-tauri
pnpm tauri signer generate -w ~/.tauri/lyra-updater.key
```

1. Choose a password when asked.
2. Put the contents of `~/.tauri/lyra-updater.key.pub` in `apps/desktop-tauri/src-tauri/tauri.conf.json` as `plugins.updater.pubkey`, replacing `UPDATER_PUBLIC_KEY_NOT_SET`. Commit that change.
3. Add the secrets:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/lyra-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you chose |

**Back up the private key and its password.** If they are lost, installed copies can no longer verify updates, and everyone would have to download the next version by hand.

## Cutting a release

1. Set the new version in the root `Cargo.toml` under `[workspace.package]`. It is the only version number; the app and `lyra-core` inherit it. Run `cargo check` to update `Cargo.lock`.
2. In `CHANGELOG.md`, move the entries under **Unreleased** into a new section for the version, dated today, and update the comparison links at the bottom. Land both changes on `main` through a pull request.
3. Tag the merge commit and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. The **release** workflow then runs three jobs:
   - **prepare** refuses a tag that doesn't match the version or an updater key that is still the placeholder, then creates a draft release with generated notes.
   - **build** builds, signs and uploads all three platforms. macOS notarization usually adds 5 to 15 minutes.
   - **publish** checks that the download files exist, then publishes the release.
5. If any build fails, the release stays a draft and nothing reaches users. Fix the problem, then rerun the failed jobs from the workflow run. To start the release again from the beginning, delete the draft and push the tag again.

To inspect a release before anyone can download it, run the workflow from the **Actions** tab (**release → Run workflow**) with the tag and **Publish** turned off. Publish the draft from the Releases page when it looks right.

A version with a hyphen, such as `v0.2.0-beta.1`, becomes a pre-release. It is downloadable from its release page, but installed copies are not offered it. In a private repository only collaborators can see it, which suits internal testing.

Two installer formats are stricter than semver about pre-release versions:

- **Windows MSI** accepts only numeric versions, so the bundler refuses `-beta.1`. Set `bundle.windows.wix.version` in `tauri.conf.json` to the version with the beta number as a fourth field (`0.2.0.1` for `0.2.0-beta.1`), and remove it again for the final release. The setup `.exe` needs nothing.
- **Linux RPM** forbids a hyphen in its version. The bundler writes it anyway, so the `.rpm` builds, but `rpm` tooling may order it oddly against later versions. Testers on Fedora and openSUSE should uninstall a beta before installing the final release.

### First release only

Turn on the website's download buttons by setting `releasesPublished = true` in `apps/website/src/site-config.ts`, then deploy the site. Until then the buttons open the downloads page instead of links that don't exist yet.

## How the app updates

- Release builds check 20 seconds after launch and every 6 hours after that. Development builds, and builds whose updater key is still the placeholder, never check.
- A newer version downloads quietly, and its signature is verified. **Restart to Install Lyra *version*** then appears at the top of the tray menu, and a **Restart to install** button appears in Settings → General → Updates. Nothing restarts until the user chooses to.
- Settings → General → Updates shows the installed version, the last check, and a **Check now** button.
- On Windows the installer runs in passive mode: a progress window, no questions.

The code is in `apps/desktop-tauri/src-tauri/src/updater.rs`. Its config is in `plugins.updater` in `tauri.conf.json`. `tauri.release.conf.json` turns on update bundles for release builds only, so local `pnpm tauri build` needs no signing key.

## Troubleshooting

- **"Tag does not match version"**: the tag must be `v` followed by the `Cargo.toml` version. Delete the tag (`git push --delete origin v0.2.0`), then fix the version or the tag.
- **"Missing repository secrets"**: one of the secrets above is not set.
- **Notarization fails**: the build log includes Apple's submission ID. Run `xcrun notarytool log <id> --key AuthKey_<KEYID>.p8 --key-id <KEYID> --issuer <ISSUER>` to see why. Unsigned nested code and missing hardened-runtime entitlements are the usual causes.
- **"Missing release files"**: the asset names changed, for example after a `tauri-action` upgrade. Update the names in the publish job and in `apps/website/src/site-config.ts` together.
- **Lyra can't read Spotify or Music in a signed build**: the build must carry the Apple Events entitlement (`src-tauri/Entitlements.plist`) and its usage description (`src-tauri/Info.plist`).

# Meowbert Desktop

The Electron app for macOS and Windows. Desktop releases build the app from this source repository and publish installers and updater files to the repository configured in [`config/desktop-release.json`](../../config/desktop-release.json).

The current repositories are:

| Purpose | Repository |
| --- | --- |
| Source code and **Desktop Release** workflow | `XInTheDark/meowbert-ai-agent` |
| Public downloads and updates | `XInTheDark/meowbert-ai-releases` |

Run commands below from the root of the source repository.

## Prepare a version

Start on `main` with the app changes committed. Choose an unused version higher than the previous release; `2026.10.31` is an example. Numeric parts cannot have leading zeroes.

```bash
npm run version:desktop                   # Show the current version
npm run version:desktop -- 2026.10.31      # Update and commit the version
git push origin main
```

The helper updates `apps/desktop/package.json` and `package-lock.json`, then automatically commits only those two files. It refuses to run if either already has uncommitted changes. It does not create a tag or publish a release.

Wait for CI to pass for the version commit before publishing. The release workflow does not wait for the separate CI workflow.

## Automatic publishing

### Set up the release token once

`DESKTOP_RELEASES_GH_TOKEN` is the name of a GitHub Actions secret used by this project's release workflow. Its value is a GitHub token that can write to the downloads repository. GitHub's built-in `GITHUB_TOKEN` only has access to the repository running the workflow, so it cannot publish from the source repository into the separate downloads repository.

You generate this token yourself; there is no existing Meowbert token to find. GitHub shows a newly generated token's value only once. If you lose the value, generate a replacement and update the Actions secret.

1. In your GitHub account, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Choose the owner of the downloads repository, select **Only select repositories**, and select `meowbert-ai-releases`. Give **Repository permissions → Contents** **Read and write** access.
3. In the **source** repository (`meowbert-ai-agent`), open **Settings → Secrets and variables → Actions → New repository secret**.
4. Name the secret `DESKTOP_RELEASES_GH_TOKEN` and paste the token as its value. Renew the secret when the token expires.

See GitHub's guidance on [token scope](https://docs.github.com/en/actions/concepts/security/github_token) and [creating fine-grained tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

### Publish from Releases in the source repository

You can create the release directly in **`meowbert-ai-agent`**, using GitHub's website:

1. Prepare and push the version as above, and configure the release token.
2. In `meowbert-ai-agent`, open **Releases → Draft a new release**.
3. Under **Choose a tag**, enter a new matching tag such as `desktop-v2026.10.31` and choose **Create new tag**. Set the target to the `main` commit containing that version.
4. Add the title and release notes, then click **Publish release**.
5. Check **Actions → Desktop Release** and wait for both platform jobs to finish. The installers and updater files are published to `meowbert-ai-releases`; the workflow also reads release notes from the matching source release when available.

Creating the new tag triggers the existing tag-push workflow. Publishing or editing a release for an already existing tag does not create another tag push; use **Actions → Desktop Release → Run workflow** if you need to start it explicitly. Saving a draft is not the publishing step.

### Publish a prepared version from Terminal

After preparing and pushing the version, push its matching tag:

```bash
git tag desktop-v2026.10.31
git push origin desktop-v2026.10.31
```

This starts [**Desktop Release**](../../.github/workflows/desktop-release.yml). It creates or reuses the matching release in the downloads repository and builds and uploads:

- macOS universal DMG and ZIP files.
- Windows x64 installer and ZIP files.
- Updater manifests and blockmaps.

Wait for both platform jobs to succeed, then check the release assets. The release entry can appear before the uploads finish.

You can also start the workflow from GitHub: in the source repository, open **Actions → Desktop Release → Run workflow**, choose `main` containing the prepared version, enter `desktop-v2026.10.31` for `release_tag`, and leave `build_only` unchecked. This uses the same release token and does not require pushing a source tag.

## Publish manually without a release token

You can create the GitHub release yourself and upload the built files using your own GitHub account. This path does not need `DESKTOP_RELEASES_GH_TOKEN`; your account needs write access to the downloads repository.

1. Prepare and push the version as above, and wait for its CI run to pass.
2. In the source repository, open **Actions → Desktop Release → Run workflow**. Choose `main` containing that version, enter its matching `release_tag` (for example, `desktop-v2026.10.31`), and check `build_only`.
3. Wait for both platform jobs, including the packaged runtime and renderer checks, to succeed. Download the workflow artifacts named `desktop-macOS` and `desktop-Windows`.
4. Extract both artifact archives. Keep all the installer, ZIP, `.blockmap`, and `latest*.yml` files inside them; preserve their filenames. The outer artifact archives and screenshot artifacts are not release assets.
5. In the **downloads** repository (`meowbert-ai-releases`), open **Releases → Draft a new release**. Choose or create the same tag, add a title such as `Meowbert Desktop 2026.10.31`, and record the source commit and workflow run in the release notes. Upload all the extracted release assets to the draft.
6. Check that both platforms' downloads and updater files are attached, select **Set as latest release** for a stable version, and publish. Verify the public downloads and updater manifests are accessible.

Creating a release in the downloads repository does not run the source repository's build workflow. The source workflow listens for tag pushes and **Run workflow**, with no `release` event trigger. Creating a new source tag through the source repository's release form triggers the tag-push path described above. GitHub's automatic source-code archives do not contain a packaged desktop app.

The [GitHub release guide](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) covers creating drafts and uploading assets.

## Package locally

For a local installer on your current platform, with dependencies installed:

```bash
npm run package --workspace apps/desktop -- --publish never
```

Output goes to `apps/desktop/dist-packages/`. Use the workflow above when you need both supported release platforms.

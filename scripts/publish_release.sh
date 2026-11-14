#!/bin/bash
# Publish desktop builds through the existing GitHub Actions release workflow.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

find_release_run() {
  local attempt run_id
  for ((attempt = 0; attempt < 30; attempt++)); do
    run_id="$(gh run list --repo "$source_repository" --workflow desktop-release.yml \
      --branch "$release_tag" --commit "$release_sha" --event push \
      --json databaseId --jq '.[0].databaseId // empty')"
    if [[ -n "$run_id" ]]; then
      printf '%s' "$run_id"
      return
    fi
    sleep 2
  done
  fail "Release workflow did not appear. Check: gh run list --repo $source_repository --workflow desktop-release.yml"
}

verify_release() {
  local asset
  gh release view "$release_tag" --repo "$target_repository" --json assets > "$release_temp/assets.json"
  node --input-type=module - "$release_temp/assets.json" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { assets } = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const name of [
  "Meowbert-desktop-mac-universal.dmg", "Meowbert-desktop-mac-universal.zip",
  "Meowbert-desktop-win-x64.exe", "Meowbert-desktop-win-x64.zip",
  "latest.yml", "latest-mac.yml", "appcast.xml"
]) {
  assert.ok(assets.some((asset) => asset.name === name && asset.size > 0), `Missing or empty release asset: ${name}`);
}
NODE
  for asset in Meowbert-desktop-mac-universal.dmg Meowbert-desktop-mac-universal.zip \
    Meowbert-desktop-win-x64.exe Meowbert-desktop-win-x64.zip latest.yml latest-mac.yml appcast.xml; do
    curl --fail --silent --show-error --location --head --output /dev/null \
      --retry 3 --connect-timeout 15 --max-time 60 "$download_base/$asset"
  done
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 60 \
    --output "$release_temp/appcast.xml" "$download_base/appcast.xml"
  node --input-type=module - "$release_temp/appcast.xml" "$download_base/Meowbert-desktop-mac-universal.zip" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const xml = readFileSync(process.argv[2], "utf8");
const enclosure = /<enclosure\b[^>]*>/.exec(xml)?.[0] ?? "";
assert.ok(enclosure.includes(`url="${process.argv[3]}"`), "Appcast ZIP URL does not match this release.");
assert.match(enclosure, /sparkle:edSignature="[^"]+"/, "Appcast archive signature is missing.");
NODE
}

for dependency in git node gh curl; do
  command -v "$dependency" >/dev/null || fail "$dependency is required. Install GitHub CLI with 'brew install gh' if needed."
done
gh auth status >/dev/null 2>&1 || fail "Authenticate first with: gh auth login"
[[ "$(git branch --show-current)" == main ]] || fail "Switch to main before publishing."
[[ -z "$(git status --porcelain)" ]] || fail "Commit or stash your working tree changes before publishing."

source_repository="$(gh repo view "$(git remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)"
# Use committed config, just as the Actions runner does, rather than local overrides.
target_repository="$(node -p 'require("./config/desktop-release.cjs").loadDesktopReleaseConfig().repository')"
git fetch origin main
git merge-base --is-ancestor origin/main HEAD || fail "main is behind or has diverged from origin/main. Update it first."

current_version="$(node scripts/desktop-version.mjs)"
suggested_version="$(node -p 'const v = require("./apps/desktop/package.json").version.split(/[+-]/)[0].split("."); v[2] = Number(v[2]) + 1; v.join(".")')"
printf '\nMeowbert Desktop release\nCurrent version: %s\n' "$current_version"
read -r -p "New version [$suggested_version]: " release_version
release_version="${release_version:-$suggested_version}"
node --input-type=module - "$release_version" <<'NODE'
import { isValidSemver } from "./scripts/desktop-version.mjs";
if (!isValidSemver(process.argv[2])) {
  console.error("Enter a semantic version such as 2026.11.5 or 2026.11.5-beta.1.");
  process.exit(1);
}
NODE
[[ "$release_version" != *+* ]] || fail "Build metadata (+...) is not supported by desktop release tags."
release_tag="desktop-v${release_version}"
git check-ref-format "refs/tags/$release_tag"
if git show-ref --verify --quiet "refs/tags/$release_tag"; then
  fail "Local tag $release_tag already exists. Choose a new version."
fi
remote_tag="$(git ls-remote --tags origin "refs/tags/$release_tag")"
[[ -z "$remote_tag" ]] || fail "Remote tag $release_tag already exists. Choose a new version."

printf '\nSource:  %s (main)\nRelease: %s\nTag:     %s\n' "$source_repository" "$target_repository" "$release_tag"
printf '\nUnpushed commits that will be included:\n'
git log --oneline origin/main..HEAD
printf '\nThis will commit the version, push main and the release tag, and publish Mac and Windows builds.\n'
read -r -p 'Publish this release? [y/N]: ' confirmation
case "$confirmation" in
  y|Y|yes|YES) ;;
  *) printf 'Cancelled. No version or release changes made.\n'; exit 0 ;;
esac

release_temp="$(mktemp -d)"
trap 'rm -rf "$release_temp"' EXIT
node scripts/desktop-version.mjs "$release_version"
release_sha="$(git rev-parse HEAD)"
git push origin main
git tag -a "$release_tag" -m "Meowbert Desktop $release_version" "$release_sha"
printf '\nRelease tag: %s. If publication fails, inspect the workflow before retrying this tag.\n' "$release_tag"
git push origin "refs/tags/$release_tag"

run_id="$(find_release_run)"
printf '\nFollowing release build: https://github.com/%s/actions/runs/%s\n' "$source_repository" "$run_id"
gh run watch "$run_id" --repo "$source_repository" --exit-status || fail "Release workflow failed. Inspect it with: gh run view $run_id --repo $source_repository --log-failed"
download_base="https://github.com/$target_repository/releases/download/$release_tag"
verify_release
printf '\nPublished and verified: https://github.com/%s/releases/tag/%s\n' "$target_repository" "$release_tag"

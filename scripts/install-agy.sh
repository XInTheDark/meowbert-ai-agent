#!/usr/bin/env bash
# Installs a pinned Antigravity CLI (agy) build into the API and worker images.
# To update: take version, url and sha512 for each platform from
# https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_<amd64|arm64>.json
set -euo pipefail

AGY_VERSION="1.5.18"
AGY_RELEASE_BASE="https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-6386224290725888"
target_dir="${1:-/usr/local/bin}"

case "$(uname -m)" in
  x86_64|amd64)
    url="$AGY_RELEASE_BASE/linux-x64/cli_linux_x64.tar.gz"
    sha512="ef379ec869719112f696e8c7cfddf776618712e58fc38e53df80801d6528abb4677782c7c8778f9c09c9123fa44c2c32675d228c06f2a8f7a8f4214e75f5bb26"
    ;;
  arm64|aarch64)
    url="$AGY_RELEASE_BASE/linux-arm/cli_linux_arm64.tar.gz"
    sha512="6c59cbce5a7632083dd4ef594296e52ce0abdc12f8b4ecb55523e093748cf178f8f8383d7e51e9ed7859ea6e46c83a43a7b46364b0e033dd13afb24d6bfbe4c8"
    ;;
  *)
    echo "Unsupported architecture for agy: $(uname -m)" >&2
    exit 1
    ;;
esac

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

curl -fsSL -o "$staging/agy.tar.gz" "$url"
echo "$sha512  $staging/agy.tar.gz" | sha512sum -c -
tar -xzf "$staging/agy.tar.gz" -C "$staging" antigravity
install -m 0755 "$staging/antigravity" "$target_dir/agy"

installed="$("$target_dir/agy" --version)"
echo "Installed agy: $installed"
case "$installed" in
  *"$AGY_VERSION"*) ;;
  *) echo "Expected agy $AGY_VERSION" >&2; exit 1 ;;
esac

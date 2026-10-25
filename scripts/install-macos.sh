#!/bin/bash
set -euo pipefail

release_base="https://github.com/XInTheDark/meowbert-ai-releases/releases"
archive_name="Meowbert-desktop-mac-universal.zip"
install_dir="${MEOWBERT_INSTALL_DIR:-/Applications}"
download_dir=""
install_stage=""
destination="$install_dir/Meowbert.app"

fail() {
  printf 'Meowbert: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$install_stage" && -d "$install_stage/previous.app" && ! -e "$destination" ]]; then
    if ! mv "$install_stage/previous.app" "$destination"; then
      printf 'Previous app retained at %s/previous.app\n' "$install_stage" >&2
      install_stage=""
    fi
  fi
  if [[ -n "$install_stage" ]]; then rm -rf "$install_stage"; fi
  if [[ -n "$download_dir" ]]; then rm -rf "$download_dir"; fi
}

download_release() {
  local latest_url release_tag expected actual
  latest_url=$(curl -fsSL --retry 3 -o /dev/null -w '%{url_effective}' "$release_base/latest")
  [[ "$latest_url" == "$release_base/tag/desktop-"* ]] || fail "Could not resolve the latest desktop release."
  release_tag="${latest_url##*/}"
  printf 'Downloading Meowbert %s...\n' "$release_tag"
  curl -fL --retry 3 --output "$download_dir/$archive_name" "$release_base/download/$release_tag/$archive_name"
  curl -fsSL --retry 3 --output "$download_dir/SHA256SUMS.txt" "$release_base/download/$release_tag/SHA256SUMS.txt"

  expected=$(awk -v file="$archive_name" '$2 == file || $2 == "*" file { print $1 }' "$download_dir/SHA256SUMS.txt")
  [[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || fail "The release has no valid macOS ZIP checksum."
  actual=$(shasum -a 256 "$download_dir/$archive_name")
  [[ "${actual%% *}" == "$expected" ]] || fail "Download checksum did not match; the installed app was not changed."
  ditto --noqtn -x -k "$download_dir/$archive_name" "$download_dir/unpacked"
}

install_app() {
  local source_app bundle_id version
  source_app="$download_dir/unpacked/Meowbert.app"
  bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_app/Contents/Info.plist" 2>/dev/null) || fail "The download does not contain a valid app."
  [[ "$bundle_id" == "ai.meowbert.desktop" && -x "$source_app/Contents/MacOS/Meowbert" ]] || fail "The download is not the Meowbert desktop app."
  version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$source_app/Contents/Info.plist")

  mkdir -p "$install_dir"
  [[ -w "$install_dir" ]] || fail "Cannot write to $install_dir. Set MEOWBERT_INSTALL_DIR to a writable Applications folder."
  [[ ! -L "$destination" ]] || fail "$destination is a symbolic link; replace it manually."
  if [[ -e "$destination" ]]; then
    bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist" 2>/dev/null) || fail "Could not identify the existing app."
    [[ "$bundle_id" == "ai.meowbert.desktop" ]] || fail "An unrelated app already exists at $destination."
  fi
  if pgrep -x Meowbert >/dev/null; then fail "Quit Meowbert before installing the update."; fi

  install_stage=$(mktemp -d "$install_dir/.meowbert-install.XXXXXX")
  ditto --noqtn "$source_app" "$install_stage/next.app"
  if [[ -e "$destination" ]]; then mv "$destination" "$install_stage/previous.app"; fi
  mv "$install_stage/next.app" "$destination"
  printf 'Installed Meowbert %s at %s. You can open it now.\n' "$version" "$destination"
}

main() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "This installer is for macOS."
  if pgrep -x Meowbert >/dev/null; then fail "Quit Meowbert before installing the update."; fi
  download_dir=$(mktemp -d "${TMPDIR:-/tmp}/meowbert-install.XXXXXX")
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  download_release
  install_app
}

main "$@"

#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_RCLONE_VERSION="1.73.3"
tmp_dir=""

cleanup() {
  if [ -n "${tmp_dir:-}" ]; then
    rm -rf "${tmp_dir}"
  fi
}

resolve_rclone_arch() {
  local debian_arch
  debian_arch="$(dpkg --print-architecture)"

  case "${debian_arch}" in
    amd64)
      printf '%s\n' "amd64"
      ;;
    arm64)
      printf '%s\n' "arm64"
      ;;
    arm)
      printf '%s\n' "arm"
      ;;
    armhf)
      printf '%s\n' "arm-v7"
      ;;
    armel)
      printf '%s\n' "arm-v6"
      ;;
    i386)
      printf '%s\n' "386"
      ;;
    mips)
      printf '%s\n' "mips"
      ;;
    mipsel)
      printf '%s\n' "mipsle"
      ;;
    *)
      printf 'Unsupported Debian architecture for pinned rclone install: %s\n' "${debian_arch}" >&2
      return 1
      ;;
  esac
}

main() {
  local version arch archive_name archive_url
  version="${1:-${DEFAULT_RCLONE_VERSION}}"
  arch="$(resolve_rclone_arch)"
  archive_name="rclone-v${version}-linux-${arch}.zip"
  archive_url="https://downloads.rclone.org/v${version}/${archive_name}"
  tmp_dir="$(mktemp -d)"

  trap cleanup EXIT

  printf 'Installing rclone v%s for linux-%s from %s\n' "${version}" "${arch}" "${archive_url}"
  curl --fail --show-error --silent --location --retry 5 --retry-all-errors "${archive_url}" -o "${tmp_dir}/rclone.zip"
  unzip -q "${tmp_dir}/rclone.zip" -d "${tmp_dir}"
  install -m 0755 "${tmp_dir}/rclone-v${version}-linux-${arch}/rclone" /usr/local/bin/rclone

  /usr/local/bin/rclone version | sed -n '1p'
}

main "$@"

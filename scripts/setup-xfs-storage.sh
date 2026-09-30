#!/usr/bin/env bash

set -euo pipefail

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

prompt() {
  local message="$1"
  local default_value="${2:-}"
  local input

  if [[ -n "$default_value" ]]; then
    read -r -p "$message [$default_value]: " input
    input="$(trim "${input:-}")"
    if [[ -z "$input" ]]; then
      input="$default_value"
    fi
  else
    while true; do
      read -r -p "$message: " input
      input="$(trim "${input:-}")"
      if [[ -n "$input" ]]; then
        break
      fi
    done
  fi

  printf '%s' "$input"
}

confirm() {
  local message="$1"
  local default_answer="${2:-y}"
  local suffix="[Y/n]"

  if [[ "$default_answer" == "n" ]]; then
    suffix="[y/N]"
  fi

  while true; do
    local input
    read -r -p "$message $suffix: " input
    input="$(trim "${input:-}")"
    if [[ -z "$input" ]]; then
      input="$default_answer"
    fi

    case "${input,,}" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
    esac
  done
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name"
    echo "Install xfsprogs first, then run this script again."
    exit 1
  fi
}

ensure_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "This helper only supports Linux hosts."
    exit 1
  fi
}

ensure_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Run this script as root or with sudo."
    exit 1
  fi
}

device_fs_type() {
  local device="$1"
  blkid -o value -s TYPE "$device" 2>/dev/null || true
}

mount_device() {
  local device="$1"
  local mount_path="$2"
  local mount_options="$3"

  mkdir -p "$mount_path"

  if findmnt -rn "$mount_path" >/dev/null 2>&1; then
    echo "Mount path already has an active mount: $mount_path"
    findmnt "$mount_path" || true
    return 0
  fi

  mount -o "$mount_options" "$device" "$mount_path"
}

verify_xfs_quota() {
  local mount_path="$1"
  echo
  echo "Verifying project quota support on $mount_path ..."
  xfs_quota -x -c 'state -p' "$mount_path"
}

append_fstab_line() {
  local fstab_line="$1"

  if grep -Fqx "$fstab_line" /etc/fstab; then
    echo "Exact /etc/fstab entry already exists."
    return 0
  fi

  printf '\n%s\n' "$fstab_line" >> /etc/fstab
  echo "Appended to /etc/fstab."
}

setup_mountpoint() {
  local label="$1"
  local default_host_mount="$2"
  local default_container_mount="$3"
  local default_project_base="$4"

  echo
  echo "=== $label ==="

  if ! confirm "Set up $label?" "y"; then
    return 1
  fi

  local device
  device="$(prompt "Block device path for $label" "")"
  if [[ ! -b "$device" ]]; then
    echo "Not a block device: $device"
    exit 1
  fi

  local existing_fs
  existing_fs="$(device_fs_type "$device")"
  echo "Detected filesystem on $device: ${existing_fs:-<none>}"

  if [[ "$existing_fs" != "xfs" ]]; then
    if confirm "Format $device as XFS? THIS DESTROYS EXISTING DATA." "n"; then
      mkfs.xfs -f "$device"
      existing_fs="xfs"
    else
      echo "Skipping format."
    fi
  fi

  local host_mount
  host_mount="$(prompt "Host mount path for $label" "$default_host_mount")"
  local container_mount
  container_mount="$(prompt "Container mount path for $label" "$default_container_mount")"
  local mount_options
  mount_options="$(prompt "Mount options" "prjquota")"
  local project_id_base
  project_id_base="$(prompt "Project id base" "$default_project_base")"

  mount_device "$device" "$host_mount" "$mount_options"
  verify_xfs_quota "$host_mount"

  local fstab_line
  fstab_line="$device  $host_mount  xfs  defaults,$mount_options  0  0"

  echo
  echo "Suggested /etc/fstab entry:"
  echo "$fstab_line"
  if confirm "Append this entry to /etc/fstab?" "y"; then
    append_fstab_line "$fstab_line"
  fi

  RESULT_ENABLED="1"
  RESULT_DEVICE="$device"
  RESULT_HOST_MOUNT="$host_mount"
  RESULT_CONTAINER_MOUNT="$container_mount"
  RESULT_PROJECT_ID_BASE="$project_id_base"
  return 0
}

print_workspace_snippet() {
  local container_mount="$1"
  local project_id_base="$2"

  cat <<EOF
{
  "id": "local-default",
  "label": "Local (XFS quotas)",
  "type": "local",
  "workspacesRoot": "$container_mount",
  "environmentsRoot": "/app/runtime/environments",
  "xfsProjectQuota": {
    "mountPath": "$container_mount",
    "projectIdBase": $project_id_base
  }
}
EOF
}

print_onedrive_cache_snippet() {
  local container_mount="$1"
  local project_id_base="$2"

  cat <<EOF
{
  "cacheDir": "$container_mount/onedrive-main",
  "cacheDirXfsProjectQuota": {
    "mountPath": "$container_mount",
    "projectIdBase": $project_id_base
  },
  "mountArgs": [
    "--allow-other",
    "--vfs-cache-max-age",
    "24h",
    "--vfs-cache-max-size",
    "30G"
  ]
}
EOF
}

ensure_linux
ensure_root
require_command mkfs.xfs
require_command xfs_quota
require_command blkid
require_command findmnt
require_command mount

echo "Meowbert XFS setup helper"
echo
echo "This will:"
echo "  - optionally format block devices as XFS"
echo "  - mount them with project quotas enabled"
echo "  - optionally append /etc/fstab entries"
echo

host_runtime_root="$(prompt "Host runtime root (the parent directory bind-mounted into /app/runtime)" "/srv/meowbert/runtime")"
container_runtime_root="$(prompt "Container runtime root" "/app/runtime")"

workspace_enabled=0
workspace_device=""
workspace_host_mount=""
workspace_container_mount=""
workspace_project_base=""

RESULT_ENABLED=0
RESULT_DEVICE=""
RESULT_HOST_MOUNT=""
RESULT_CONTAINER_MOUNT=""
RESULT_PROJECT_ID_BASE=""
if setup_mountpoint \
  "Workspace XFS storage" \
  "$host_runtime_root/workspaces-xfs" \
  "$container_runtime_root/workspaces-xfs" \
  "10000"; then
  workspace_enabled="$RESULT_ENABLED"
  workspace_device="$RESULT_DEVICE"
  workspace_host_mount="$RESULT_HOST_MOUNT"
  workspace_container_mount="$RESULT_CONTAINER_MOUNT"
  workspace_project_base="$RESULT_PROJECT_ID_BASE"
fi

cache_enabled=0
cache_device=""
cache_host_mount=""
cache_container_mount=""
cache_project_base=""

RESULT_ENABLED=0
RESULT_DEVICE=""
RESULT_HOST_MOUNT=""
RESULT_CONTAINER_MOUNT=""
RESULT_PROJECT_ID_BASE=""
if setup_mountpoint \
  "OneDrive cache XFS storage" \
  "$host_runtime_root/storage-cache-xfs" \
  "$container_runtime_root/storage-cache-xfs" \
  "30000"; then
  cache_enabled="$RESULT_ENABLED"
  cache_device="$RESULT_DEVICE"
  cache_host_mount="$RESULT_HOST_MOUNT"
  cache_container_mount="$RESULT_CONTAINER_MOUNT"
  cache_project_base="$RESULT_PROJECT_ID_BASE"
fi

echo
echo "=== Summary ==="
if [[ "$workspace_enabled" == "1" ]]; then
  echo "Workspace XFS mount:"
  echo "  device: $workspace_device"
  echo "  host:   $workspace_host_mount"
  echo "  cont:   $workspace_container_mount"
else
  echo "Workspace XFS mount: skipped"
fi

if [[ "$cache_enabled" == "1" ]]; then
  echo "OneDrive cache XFS mount:"
  echo "  device: $cache_device"
  echo "  host:   $cache_host_mount"
  echo "  cont:   $cache_container_mount"
else
  echo "OneDrive cache XFS mount: skipped"
fi

echo
echo "=== Config snippets ==="
if [[ "$workspace_enabled" == "1" ]]; then
  echo
  echo "Local backend snippet:"
  print_workspace_snippet "$workspace_container_mount" "$workspace_project_base"
fi

if [[ "$cache_enabled" == "1" ]]; then
  echo
  echo "OneDrive backend cache snippet:"
  print_onedrive_cache_snippet "$cache_container_mount" "$cache_project_base"
fi

echo
echo "=== Next steps ==="
echo "1. Make sure your Docker bind source points at $host_runtime_root for /app/runtime."
echo "   With this repo's docker-compose.yml, set:"
echo "   MEOWBERT_RUNTIME_PATH=$host_runtime_root"
echo "2. Update config/global.json or config/global.docker.json with the snippets above."
if [[ "$workspace_enabled" == "1" ]]; then
  echo "3. Restart API + worker."
  echo "4. In Admin -> Migrations, run:"
  echo "   - Nest environments under workspace storage units"
  echo "   - Migrate local workspaces to XFS storage units"
else
  echo "3. Restart API + worker after updating config."
fi
if [[ "$cache_enabled" == "1" ]]; then
  echo "5. For OneDrive backends, keep cacheDir on $cache_container_mount/<backend-id>."
fi

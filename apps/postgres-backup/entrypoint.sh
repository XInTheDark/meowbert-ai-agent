#!/usr/bin/env bash
set -euo pipefail

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

write_runtime_env() {
  local output_path="/app/runtime-env.sh"
  local vars=(
    POSTGRES_HOST
    POSTGRES_PORT
    POSTGRES_DB
    POSTGRES_USER
    POSTGRES_PASSWORD
    BACKUP_KEEP_DAYS
    BACKUP_KEEP_WEEKS
    BACKUP_KEEP_MONTHS
  )

  : >"$output_path"
  for name in "${vars[@]}"; do
    printf "export %s=%q\n" "$name" "${!name}" >>"$output_path"
  done
}

write_cron_file() {
  local cron_path="/etc/cron.d/postgres-backup"
  local cron_command="source /app/runtime-env.sh && /app/backup.sh"

  {
    echo "SHELL=/bin/bash"
    echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    printf "%s root bash -lc %q\n" "$SCHEDULE" "$cron_command"
  } >"$cron_path"

  chmod 0644 "$cron_path"
}

require_var "POSTGRES_HOST"
require_var "POSTGRES_DB"
require_var "POSTGRES_USER"
require_var "POSTGRES_PASSWORD"

POSTGRES_PORT="${POSTGRES_PORT:-5432}"
SCHEDULE="${SCHEDULE:-0 */6 * * *}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-3}"
BACKUP_KEEP_WEEKS="${BACKUP_KEEP_WEEKS:-1}"
BACKUP_KEEP_MONTHS="${BACKUP_KEEP_MONTHS:-0}"

mkdir -p /backups/daily /backups/weekly /backups/monthly /backups/last
write_runtime_env
write_cron_file

exec cron -f

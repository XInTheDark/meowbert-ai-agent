#!/usr/bin/env bash
set -euo pipefail

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

require_int() {
  local name="$1"
  if ! [[ "${!name}" =~ ^[0-9]+$ ]]; then
    echo "Expected $name to be a non-negative integer, got: ${!name}" >&2
    exit 1
  fi
}

link_backup() {
  local source_path="$1"
  local target_path="$2"

  rm -f "$target_path"
  ln "$source_path" "$target_path"
}

refresh_latest_symlink() {
  local bucket_dir="$1"
  local latest_name="$2"
  local latest_symlink="$bucket_dir/$BACKUP_NAME-latest.sql.gz"

  rm -f "$latest_symlink"
  if [[ -n "$latest_name" ]]; then
    ln -s "$latest_name" "$latest_symlink"
  fi
}

list_bucket_files() {
  local bucket_dir="$1"

  find "$bucket_dir" -maxdepth 1 -type f -name "$BACKUP_NAME-*.sql.gz" -exec basename {} \; | sort -r
}

prune_bucket() {
  local bucket_dir="$1"
  local keep_count="$2"
  local file_name=""
  local latest_name=""
  local index=0

  latest_name="$(list_bucket_files "$bucket_dir" | head -n 1)"

  if (( keep_count <= 0 )); then
    while IFS= read -r file_name; do
      if [[ -z "$file_name" ]]; then
        continue
      fi
      rm -f "$bucket_dir/$file_name"
    done < <(list_bucket_files "$bucket_dir")
    refresh_latest_symlink "$bucket_dir" ""
    return
  fi

  while IFS= read -r file_name; do
    if [[ -z "$file_name" ]]; then
      continue
    fi
    index=$((index + 1))
    if (( index > keep_count )); then
      rm -f "$bucket_dir/$file_name"
    fi
  done < <(list_bucket_files "$bucket_dir")

  latest_name="$(list_bucket_files "$bucket_dir" | head -n 1)"
  refresh_latest_symlink "$bucket_dir" "$latest_name"
}

keep_latest_last_backup() {
  local current_name="$1"
  local last_dir="$BACKUP_ROOT/last"

  find "$last_dir" -maxdepth 1 -type f -name "$BACKUP_NAME-*.sql.gz" ! -name "$current_name" -delete
  refresh_latest_symlink "$last_dir" "$current_name"
}

require_var "POSTGRES_HOST"
require_var "POSTGRES_PORT"
require_var "POSTGRES_DB"
require_var "POSTGRES_USER"
require_var "POSTGRES_PASSWORD"
require_var "BACKUP_KEEP_DAYS"
require_var "BACKUP_KEEP_WEEKS"
require_var "BACKUP_KEEP_MONTHS"
require_int "BACKUP_KEEP_DAYS"
require_int "BACKUP_KEEP_WEEKS"
require_int "BACKUP_KEEP_MONTHS"

BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
BACKUP_NAME="${BACKUP_NAME:-$POSTGRES_DB}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
DAY_STAMP="$(date -u +%Y%m%d)"
WEEK_STAMP="$(date -u +%G%V)"
MONTH_STAMP="$(date -u +%Y%m)"
LAST_DIR="$BACKUP_ROOT/last"
TMP_DIR="$BACKUP_ROOT/.tmp"
LAST_FILE_NAME="$BACKUP_NAME-$TIMESTAMP.sql.gz"
LAST_FILE_PATH="$LAST_DIR/$LAST_FILE_NAME"
TEMP_FILE_PATH="$TMP_DIR/$LAST_FILE_NAME.partial"

mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/monthly" "$LAST_DIR" "$TMP_DIR"

export PGPASSWORD="$POSTGRES_PASSWORD"
pg_dump \
  --host="$POSTGRES_HOST" \
  --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" \
  "$POSTGRES_DB" \
  | gzip --rsyncable >"$TEMP_FILE_PATH"
mv "$TEMP_FILE_PATH" "$LAST_FILE_PATH"

if (( BACKUP_KEEP_DAYS > 0 )); then
  link_backup "$LAST_FILE_PATH" "$BACKUP_ROOT/daily/$BACKUP_NAME-$DAY_STAMP.sql.gz"
fi
if (( BACKUP_KEEP_WEEKS > 0 )); then
  link_backup "$LAST_FILE_PATH" "$BACKUP_ROOT/weekly/$BACKUP_NAME-$WEEK_STAMP.sql.gz"
fi
if (( BACKUP_KEEP_MONTHS > 0 )); then
  link_backup "$LAST_FILE_PATH" "$BACKUP_ROOT/monthly/$BACKUP_NAME-$MONTH_STAMP.sql.gz"
fi

keep_latest_last_backup "$LAST_FILE_NAME"
prune_bucket "$BACKUP_ROOT/daily" "$BACKUP_KEEP_DAYS"
prune_bucket "$BACKUP_ROOT/weekly" "$BACKUP_KEEP_WEEKS"
prune_bucket "$BACKUP_ROOT/monthly" "$BACKUP_KEEP_MONTHS"

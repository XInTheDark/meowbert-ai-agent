#!/usr/bin/env bash
# First-time setup for running Meowbert with Docker Compose.
# Safe to re-run: existing files and directories are left alone.
set -euo pipefail

cd "$(dirname "$0")/.."

config_path="config/global.docker.json"
if [ -f "$config_path" ]; then
  echo "Keeping existing $config_path"
else
  jwt_secret="$(openssl rand -hex 32)"
  sed "s/REPLACE_WITH_JWT_SECRET/${jwt_secret}/" config/global.docker.example.json > "$config_path"
  echo "Created $config_path with a new JWT secret"
fi

# Host directories used by docker-compose.yml. Override the data paths in .env
# (MEOWBERT_POSTGRES_DATA_PATH, MEOWBERT_POSTGRES_BACKUP_PATH,
# MEOWBERT_MEILISEARCH_DATA_PATH) if you want them somewhere else.
set -a
[ -f .env ] && . ./.env
set +a
host_dirs=(
  "/srv/meowbert/runtime"
  "${MEOWBERT_MEILISEARCH_DATA_PATH:-/srv/meowbert/runtime/meilisearch}"
  "${MEOWBERT_POSTGRES_DATA_PATH:-/data/meowbert/postgres-data}"
  "${MEOWBERT_POSTGRES_BACKUP_PATH:-/data/meowbert/postgres-backups}"
)

for dir in "${host_dirs[@]}"; do
  if [ -d "$dir" ]; then
    continue
  fi
  if mkdir -p "$dir" 2>/dev/null; then
    echo "Created $dir"
  else
    echo "Creating $dir (needs sudo)"
    sudo mkdir -p "$dir"
  fi
done

echo
echo "Setup complete. Start Meowbert with:"
echo "  docker compose up -d"
echo "Then open http://localhost:5173 and create the first account (it becomes the admin)."

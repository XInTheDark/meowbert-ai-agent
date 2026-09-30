#!/bin/bash
set -e

umask 0002

api_url="${MEOWBERT_API_URL:-http://api:4000}"

echo "[entrypoint] Waiting for API to be healthy at ${api_url}/health…"
until curl -sf "${api_url}/health" > /dev/null 2>&1; do
  sleep 2
done
echo "[entrypoint] API is healthy. Migrations are applied."

exec "$@"

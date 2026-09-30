#!/bin/bash
set -e

umask 0002

host="${DATABASE_HOST:-localhost}"
port="${DATABASE_PORT:-5432}"

echo "[entrypoint] Waiting for Postgres at ${host}:${port}…"
until bash -c "echo > /dev/tcp/${host}/${port}" 2>/dev/null; do
  sleep 1
done
echo "[entrypoint] Postgres is accepting connections."

exec "$@"

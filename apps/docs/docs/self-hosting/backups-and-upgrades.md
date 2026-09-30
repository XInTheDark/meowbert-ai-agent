---
title: Backups & Upgrades
summary: Keep your data safe and update Meowbert to new versions.
---

# Backups & Upgrades

## What to back up

| Data | Where | Backed up automatically? |
| --- | --- | --- |
| Database (users, tasks, conversations, settings) | `/data/meowbert/postgres-data` | Yes, as weekly dumps in `/data/meowbert/postgres-backups` |
| Project and task files | `/srv/meowbert/runtime` | No |
| Your configuration | `config/global.docker.json`, `.env` | No |

The `postgres-backup` service writes a compressed `pg_dump` every Sunday at midnight and keeps two weeks by default. Change the schedule and retention in `.env` (`MEOWBERT_POSTGRES_BACKUP_SCHEDULE`, `MEOWBERT_POSTGRES_BACKUP_KEEP_WEEKS`, …).

For a complete backup, copy the database dumps, `/srv/meowbert/runtime`, and your config files to another machine or storage with your usual tool, such as restic, borg, or rsync.

## Restoring the database

```bash
gunzip -c /data/meowbert/postgres-backups/last/<backup>.sql.gz \
  | docker compose exec -T meowbert-postgres psql -U postgres -d meowbert
```

Restore into an empty database, before starting the API and worker.

## Upgrading

```bash
git pull
docker compose pull sandbox-runtime
docker compose up -d --build
```

If you run the full stack with email, add `-f docker-compose.full.yml` to both `docker compose` commands.

Database migrations run automatically when the API starts. Check the [changelog](https://github.com/XInTheDark/meowbert-ai-agent/blob/main/CHANGELOG.md) before upgrading for anything that needs your attention.

---
title: Configuration
summary: Where Meowbert's settings live and the ones you're most likely to change.
---

# Configuration

Meowbert has three places for settings:

| Where | What goes there | How to change it |
| --- | --- | --- |
| **Admin Panel** | Model providers, models, sign-ups, connectors, sources, limits, and most day-to-day settings | In the web app. Changes apply immediately. |
| **`config/global.docker.json`** | Server-level settings: storage paths, sandbox limits, skills, email | Edit the file, then `docker compose restart api worker` |
| **`.env`** | Docker Compose settings: passwords, host data paths, ports, API keys for skills | Copy `.env.example` to `.env`, edit, then `docker compose up -d` |

You rarely need to touch the config file after [setup](/getting-started/quickstart). `scripts/setup.sh` creates it from `config/global.docker.example.json`. For running outside Docker, `config/global.example.json` is the equivalent starting point.

## Settings you might change

### Sandbox resources

```json
"runtime": {
  "maxSteps": 800,
  "workerConcurrency": 4,
  "sandbox": {
    "resources": { "memoryMb": 2048, "cpus": 2, "pids": 256, "storageMb": 4096 }
  }
}
```

- `maxSteps`: the most tool calls one task run can make
- `workerConcurrency`: how many task runs the worker handles at once
- `sandbox.resources`: limits for each task's container. `storageMb` is the per-workspace storage limit (a user's plan or admin override can change it). Without [XFS project quotas](/reference/xfs-project-quotas) it is a soft limit: uploads and files copied in from connected sources are refused once a workspace is full, but files that tasks write are not capped.

### Skills

`skills.browserUse`, `skills.htmlCanvas`, and `skills.office` turn the browser, canvas, and Office skills on or off. They also control what's bundled into a locally built sandbox image.

### Email

Off by default. See [Outgoing Email](/reference/email-delivery).

### Storage

Where project and workspace files live. The default keeps everything under `/srv/meowbert/runtime`. See [Storage Backends](/reference/storage-backends) and, for per-workspace disk quotas, [XFS Project Quotas](/reference/xfs-project-quotas).

## Passwords and ports

Postgres, Redis, and Meilisearch listen on `127.0.0.1` only and use default passwords. That's fine on a single machine. If you change the bind addresses, set real passwords in `.env` first:

```bash
MEOWBERT_POSTGRES_PASSWORD=…
MEOWBERT_REDIS_PASSWORD=…
MEOWBERT_MEILISEARCH_MASTER_KEY=…
```

## Reaching Meowbert from other machines

By default the web app (port 5173) calls the API at `http://localhost:4000`, which only works on the server itself. To use Meowbert from other devices:

1. Put the web app and the API behind a reverse proxy with HTTPS, for example `https://meowbert.example.com` and `https://api.meowbert.example.com`.
2. In `.env`, set:
   ```bash
   VITE_API_URL=https://api.meowbert.example.com
   VITE_ALLOWED_HOSTS=meowbert.example.com
   ```
3. In the config file, set `server.publicUrl` to the API address and `web.appUrl` to the web address.
4. Rebuild the web app, since the API address is built into it: `docker compose build web && docker compose up -d`.

Connectors that receive webhooks (Telegram, Discord, GitHub, and inbound email) also need the API to be reachable from the internet.

## Data locations

| Data | Default host path |
| --- | --- |
| Project files, task files, search index | `/srv/meowbert/runtime` |
| PostgreSQL database | `/data/meowbert/postgres-data` |
| Weekly database backups | `/data/meowbert/postgres-backups` |

See [Backups & Upgrades](/self-hosting/backups-and-upgrades).

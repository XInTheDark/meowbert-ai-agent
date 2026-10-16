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
- `sandbox.resources`: limits for each task's container. `storageMb` is the per-workspace storage limit (a user's plan or admin override can change it). It is only enforced, and usage only shown, on backends with [XFS project quotas](/reference/xfs-project-quotas); elsewhere workspaces are not capped.

### Skills

`skills.browserUse`, `skills.htmlCanvas`, and `skills.office` turn the browser, canvas, and Office skills on or off. They also control what's bundled into a locally built sandbox image.

### Email

Off by default. See [Outgoing Email](/reference/email-delivery).

### Storage

Where project and workspace files live. The default keeps everything under `/srv/meowbert/runtime`. See [Storage Backends](/reference/storage-backends) and, for per-workspace disk quotas, [XFS Project Quotas](/reference/xfs-project-quotas).

### Task scratch

Each task gets a scratch folder on local disk, `$TASK_SCRATCH_DIR`, for work that makes lots of small files: cloning git repos, installing dependencies, builds. Agents keep normal files in the task folder, but a `git clone` onto a network mount such as `rclone` can take minutes, so they use scratch for this instead.

```json
"runtime": {
  "taskScratch": {
    "root": "/app/runtime/task-scratch",
    "xfsProjectQuota": { "mountPath": "/app/runtime/task-scratch" }
  }
}
```

- `root`: where scratch folders live inside the API and worker containers. It defaults to `task-scratch` next to `tasksRoot`, which is `/srv/meowbert/runtime/task-scratch` on the host. Keep it on local disk.
- `xfsProjectQuota`: optional. When `root` is an XFS mount with project quotas, each workspace's scratch is capped at its workspace storage limit (`storageMb`). Without it, scratch is limited only by the disk it's on.

Scratch is deleted when its task is deleted, expires, or moves to cold storage. It isn't shown in the file browser.

To give scratch its own fixed-size XFS filesystem from an image file:

```bash
sudo truncate -s 10G /srv/meowbert/loop-images/task-scratch.img
sudo mkfs.xfs /srv/meowbert/loop-images/task-scratch.img
sudo mkdir -p /srv/meowbert/runtime/task-scratch
echo "/srv/meowbert/loop-images/task-scratch.img /srv/meowbert/runtime/task-scratch xfs loop,prjquota,nofail,x-systemd.before=docker.service 0 0" | sudo tee -a /etc/fstab
sudo mount /srv/meowbert/runtime/task-scratch
```

The image size caps all scratch together. Mount it before Docker starts so the containers see it.

## Passwords and ports

Postgres, Redis, and Meilisearch listen on `127.0.0.1` only and use default passwords. That's fine on a single machine. If you change the bind addresses, set real passwords in `.env` first:

```bash
MEOWBERT_POSTGRES_PASSWORD=…
MEOWBERT_REDIS_PASSWORD=…
MEOWBERT_MEILISEARCH_MASTER_KEY=…
```

## Reaching Meowbert from other machines

The web app (port 5173) serves the API under its own `/api` path, so browsers only need to reach the web address. To use Meowbert from other devices:

1. Put the web app and the API behind a reverse proxy with HTTPS, for example `https://meowbert.example.com` and `https://api.meowbert.example.com`.
2. In the config file, set `server.publicUrl` to the API address and `web.appUrl` to the web address.

Keeping the API on the web address is faster, since browsers skip a CORS check on every request. To make the web app call a separate API address instead, set `VITE_API_URL` in `.env` and rebuild it with `docker compose build web && docker compose up -d`.

Connectors that receive webhooks (Telegram, Discord, GitHub, and inbound email) also need the API to be reachable from the internet.

## Data locations

| Data | Default host path |
| --- | --- |
| Project files, task files, search index | `/srv/meowbert/runtime` |
| PostgreSQL database | `/data/meowbert/postgres-data` |
| Weekly database backups | `/data/meowbert/postgres-backups` |

See [Backups & Upgrades](/self-hosting/backups-and-upgrades).

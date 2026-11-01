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

### Cold task history

Cold storage moves large conversation and execution payloads from PostgreSQL to a mounted archive. Conversations remain browsable; continuing a task loads its execution state, while older messages and media are read when needed. Task IDs, branches, and ordering stay in PostgreSQL. Task files remain in their normal project storage.

When updating an existing installation, apply migration 160 before using the new archive readers. Docker installs run migrations when the API starts; source installs use `npm run migrate`.

Configure `taskHistoryArchive` in your server JSON config, with the same archive mount available to the API and worker:

```json
{
  "taskHistoryArchive": {
    "mountPath": "/app/runtime/storage/task-history-archive",
    "archivesDir": "tasks"
  }
}
```

The example path must be an existing mounted filesystem inside both containers. Restart the API and worker after changing it. In **Admin → Host Storage**, set **Warm retention (days)** to choose when inactive history can move to the archive. `0` disables automatic archiving.

Retention follows three rules:

- Browsing reads archived chunks directly. Each process keeps a disposable read cache for one hour, capped at 128 MiB; reading again does not extend the hour. Oversized chunks bypass the cache.
- Actual task work uses the configured retention period. Opening an old answer does not restore it to PostgreSQL or start another full retention period.
- Older messages and closed context windows can cool independently of an active task. The latest 128 messages, current run, open windows, notes, and pending work stay available. Cooling an old segment leaves the active task's scratch intact.

New archives separate conversation, execution state, and individual media blobs. Existing single-file archives remain readable; their first uncached read still decompresses the old file. While automatic archiving is enabled, the worker converts accessed legacy archives in the background, retaining the original until task deletion.

Global search for a fully cold task remains limited to its title and metadata. Search within an opened conversation reads archived message text as needed. Keep the archive with your database backups: PostgreSQL alone no longer contains every historical payload. See [Backups & Upgrades](./backups-and-upgrades) for what to copy and restore together.

### Local task execution

Meowbert Desktop can execute tasks on the user's computer while the server keeps conversations, model access and task state. Local execution is disabled by default; both a server configuration change and desktop setup are required.

See [Local execution](./local-execution) for the JSON settings, internal worker address, shared-storage examples, and the difference between server-hosted and device-hosted workspaces. Desktop users should start with the [Local tasks overview](/getting-started/desktop-app/local-tasks).

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

Scratch is deleted when its task is deleted, expires, or is archived as a whole. Cooling older messages or closed context windows while the task remains active does not clear its scratch. Scratch isn't shown in the file browser.

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

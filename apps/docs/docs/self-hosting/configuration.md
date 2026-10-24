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

### Local task execution

Local execution is disabled by default. Enable `localExecution.enabled` and configure the worker's `runApi` listener and an API-reachable worker URL before enabling it in the desktop app. The API forwards scoped Run API requests to the claiming worker; keep that listener private. Model calls continue to use server credentials, which are never sent to the desktop.

Use the published sandbox image with a multi-architecture manifest digest. Cloud workers use `linux/amd64`; Apple Silicon and Windows arm64 devices use `linux/arm64`, and Windows x64 uses `linux/amd64`. Docker Desktop must run Linux containers. The Windows default transport is `npipe:////./pipe/dockerDesktopLinuxEngine`; a different local pipe can be selected with `DOCKER_HOST`.

For another machine to run a server-hosted workspace, export the backend root over SMB or NFS and mount that same root on the device. Enter its backend ID and mount path in Desktop Preferences. The folder must contain the server-written `.meowbert-storage.json` marker. Docker Desktop also needs access to the mount. UID mapping, NFS squash rules, SMB permissions, and Docker file sharing are the operator's responsibility. Storage probes fail closed; there is no host-mode fallback in this release.

Every user who can mount a backend can read that backend. Use separate storage backends per tenant on a multi-tenant installation. Independent mounts of the same remote service, including Google Drive for desktop alongside server rclone, remain unsupported because their caches can disagree.

Apply migration `145_local_storage_visibility.sql` before starting the updated services. The Run API protocol is version 2; update the server and desktop together. Uploads record size and SHA-256. Device outputs persist as pending and are checked by name with backoff for up to 30 minutes. Completion queues memory indexing immediately and at one and five minutes, with durable retries after restarts. No workspace or project directory scan is used for these checks.

Before accepting a new Docker Desktop/network-share combination, run the opt-in mount test from the repository on the device. Set `TEST_LOCAL_STORAGE_ROOT`, `TEST_LOCAL_STORAGE_BACKEND_ID`, `TEST_LOCAL_STORAGE_INSTALL_ID`, and `TEST_LOCAL_SANDBOX_IMAGE` to the actual mounted backend and pinned image, then run:

```sh
npm run test --workspace apps/desktop -- src/main/storage/network-storage.integration.test.ts
```

This checks the marker, a container write/delete probe, and host/container named-file reads and writes. It requires a running daemon and the image already installed. Also verify a packaged desktop task, cancellation, follow-up, and delayed server visibility on each target platform; passing mocked tests alone does not establish network-mount support.

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

---
title: Coolify Runtime Storage & XFS Migration
summary: Move Meowbert runtime storage onto a stable Coolify host path and migrate local workspaces onto XFS-backed storage.
---

# Coolify Runtime Storage & XFS Migration

If you deploy Meowbert on **Coolify** using the repo’s `docker-compose.yml`, the runtime bind path matters a lot for XFS.

## The important rule

The XFS mountpoints must live **under the exact host directory** that is bind-mounted into `/app/runtime`.

Inside the containers, Meowbert always uses:

```txt
/app/runtime
```

So on the host, you should bind one stable parent directory into that path.

## Recommended Coolify setup

Use the production runtime path expected by the Coolify compose file:

```txt
MEOWBERT_RUNTIME_PATH=/srv/meowbert/runtime
```

The compose file binds this path directly for API and worker:

```txt
/srv/meowbert/runtime  ->  /app/runtime
```

This is the recommended production setup because:

- it gives you one stable host path outside the release checkout
- it lets you mount XFS filesystems under that parent directory
- those nested mounts remain visible inside the containers because the bind uses `rshared`

## Important: changing the parent runtime bind is a one-time host data migration

If you were previously using the default runtime bind:

```txt
./runtime -> /app/runtime
```

and you now switch to:

```txt
/srv/meowbert/runtime -> /app/runtime
```

the container path stays the same, but the **host source directory changes**.

That means your existing runtime data will only remain visible if you first copy the old host runtime tree into the new host runtime path.

This is the safe order:

1. stop the stack
2. locate the **current host source** that is bound to `/app/runtime`
3. copy that runtime tree into `/srv/meowbert/runtime`
4. then set `MEOWBERT_RUNTIME_PATH=/srv/meowbert/runtime`
5. redeploy

If you skip the copy, the app will start against a different, empty host runtime tree and your old local data will appear missing.

## How to find the current host runtime source

On the host, inspect the running API container:

```bash
docker inspect <api-container-name-or-id> \
  --format '{{range .Mounts}}{{if eq .Destination "/app/runtime"}}{{.Source}}{{end}}{{end}}'
```

That prints the current host path backing `/app/runtime`.

## One-time copy example

After stopping the stack:

```bash
sudo mkdir -p /srv/meowbert/runtime
sudo rsync -aHAX --info=progress2 <old-runtime-source>/ /srv/meowbert/runtime/
```

Copy the whole runtime tree, especially:

- `workspaces/`
- `projects/`
- `storage/`
- `storage-state/`

`tasks/` can also be copied; it is usually less important, but copying the full runtime tree is the simplest and safest move.

## Will Meowbert migrations still work after that?

Yes.

Meowbert stores runtime paths as **container paths** like:

```txt
/app/runtime/workspaces/...
/app/runtime/projects/...
```

So as long as the new host bind still maps to `/app/runtime` **and** you copied the old runtime tree into the new host source first, the admin migrations still see the same in-container paths and work normally.

That includes:

- **Nest projects under workspace storage units**
- **Migrate local workspaces to XFS storage units**

The second migration still expects the old local workspace source at `/app/runtime/workspaces` to be visible while it moves data into `/app/runtime/workspaces-xfs`.

## Why not rely on `./runtime` in Coolify?

The hosted compose file does not use a relative fallback for this bind:

```txt
/srv/meowbert/runtime
```

This avoids Coolify's pre-Compose volume parser and keeps the nested Drive and storage mounts shared between the API, worker, and task sandboxes. Local deployments should use a separate local-only Compose override if they need a different host path.

Coolify’s own documentation also notes that relative bind/storage paths are created relative to its managed service directory rather than some fixed path you control directly. For XFS host setup, a stable absolute host path is much cleaner and more predictable.

## Recommended host directory layout

Once `MEOWBERT_RUNTIME_PATH=/srv/meowbert/runtime`, the host should look like this:

```txt
/srv/meowbert/runtime
├── workspaces
├── projects
├── tasks
├── workspaces-xfs
└── storage-cache-xfs
```

And inside the containers that becomes:

```txt
/app/runtime
├── workspaces
├── projects
├── tasks
├── workspaces-xfs
└── storage-cache-xfs
```

`workspaces-xfs` is the XFS-backed root for the local storage backend.

`storage-cache-xfs` is optional and only needed if you separately manage a host-side cache path for an external mount.

## What the XFS setup script does

Run this directly on the host:

```bash
sudo ./scripts/setup-xfs-storage.sh
```

The script:

1. asks for the **host runtime root**
2. asks whether to set up **workspace XFS storage**
3. optionally asks whether to set up an extra XFS cache mount
4. asks which block device to use for each selected mount
5. optionally formats the device as XFS
6. creates the host mountpoint directory
7. mounts the device with `prjquota`
8. verifies `xfs_quota`
9. optionally appends the `/etc/fstab` entry
10. prints the Meowbert config snippet you should use

## Important nuance about what the script creates

The script creates the **host mount roots**, for example:

```txt
/srv/meowbert/runtime/workspaces-xfs
/srv/meowbert/runtime/storage-cache-xfs
```

It does **not** pre-create every per-workspace subdirectory.

Those are created later by Meowbert, for example:

```txt
/app/runtime/workspaces-xfs/<workspaceId>/root
```

## Local backend XFS setup

The local backend should point at the XFS-backed workspace root:

```json
{
  "id": "local-default",
  "label": "Local (XFS quotas)",
  "type": "local",
  "workspacesRoot": "/app/runtime/workspaces-xfs",
  "projectsRoot": "/app/runtime/projects",
  "xfsProjectQuota": {
    "mountPath": "/app/runtime/workspaces-xfs",
    "projectIdBase": 10000
  }
}
```

That config is already present in `config/global.docker.json`.

## Optional host-side cache XFS setup

If you run something like `rclone mount` on the host and want to cap its cache with XFS, do that as part of the **host mount service** itself.

Meowbert no longer manages remote mount cache directories in storage backend config.

## Full deployment order for Coolify + XFS

1. Set `MEOWBERT_RUNTIME_PATH=/srv/meowbert/runtime` in Coolify.
2. Find and copy the old runtime tree into `/srv/meowbert/runtime` if you are migrating from the old `./runtime` bind.
3. Deploy or redeploy so the parent bind exists.
4. Run the host helper:
   ```bash
   sudo ./scripts/setup-xfs-storage.sh
   ```
5. Confirm the host XFS mounts exist:
   - `/srv/meowbert/runtime/workspaces-xfs`
   - optionally `/srv/meowbert/runtime/storage-cache-xfs`
6. Make sure `config/global.docker.json` points at:
   - `/app/runtime/workspaces-xfs` for local workspace storage
   - optionally another host-managed cache path if your external mount service needs one
7. Redeploy API + worker.
8. In the admin panel, go to **Admin → Migrations**.
9. Run:
   - **Nest projects under workspace storage units**
   - **Migrate local workspaces to XFS storage units**

## How the bind + nested mounts work

After setup, the model is:

```txt
Host:
  /srv/meowbert/runtime                   <- bind-mounted into /app/runtime
  /srv/meowbert/runtime/workspaces-xfs    <- nested XFS mount
  /srv/meowbert/runtime/storage-cache-xfs <- optional nested XFS mount

Container:
  /app/runtime
  /app/runtime/workspaces-xfs
  /app/runtime/storage-cache-xfs
```

Because the `/app/runtime` bind uses `rshared`, the nested host mounts under `/srv/meowbert/runtime` remain visible inside API/worker containers.

## References

- Coolify Docker Compose docs: https://coolify.io/docs/knowledge-base/docker/compose
- Coolify WordPress service docs (example relative persistent storage paths): https://coolify.io/docs/services/wordpress

---
title: Storage Backends
summary: Configure local or externally mounted workspace storage paths.
---

# Storage Backends

Meowbert can store workspaces and projects on different filesystem backends:

- **Local** — the current built-in runtime folders on the host.
- **Mounted path** — any filesystem that is already mounted on the host and visible inside the API/worker containers.

A mounted path backend is intentionally simple. Meowbert does **not** mount NFS, rclone, SSHFS, SMB, or any other network filesystem for you.

Instead, you mount that storage on the **host first**, then point Meowbert at the directory path that is already mounted.

This is a server-admin feature. After a backend is configured in `config/global.json`, super admins can:

- set the **default backend** for new workspaces
- move an existing workspace onto another backend from **Admin → Storage**

If you want **hard per-workspace storage limits** on a local backend, see [XFS Project Quotas](/reference/xfs-project-quotas).

## How mounted-path backends work

A mounted-path backend only needs:

- a backend id
- a mounted directory path such as `/app/runtime/storage/mounted-onedrive`
- optional `workspacesDir` / `projectsDir` subfolder names

Meowbert expects that path to already be mounted and visible from inside the API and worker containers.

That means the normal setup flow is:

1. mount the remote filesystem on the host
2. make sure that mounted directory is inside the host path that is bind-mounted into `/app/runtime`
3. point `storage.backends[].mountPath` at the corresponding **container path**
4. restart API + worker
5. switch the backend in **Admin → Storage**

## Before you start

For mounted-path backends, check:

- API and worker services can both see the same `/app/runtime` bind mount
- the host-side mounted directory lives under that bind-mounted runtime tree
- the mounted path stays available after reboot, usually via `/etc/fstab` or a system service
- the service user/container has read/write access to the mounted filesystem

## Example config

```json
{
  "storage": {
    "defaultWorkspaceBackendId": "local-default",
    "backends": [
      {
        "id": "mounted-shared",
        "label": "Mounted Shared Runtime",
        "type": "mounted",
        "mountPath": "/app/runtime/storage/mounted-shared",
        "workspacesDir": "workspaces",
        "projectsDir": "projects"
      },
      {
        "id": "onedrive-main",
        "label": "Mounted OneDrive Runtime",
        "type": "mounted",
        "mountPath": "/app/runtime/storage/onedrive-main",
        "workspacesDir": "workspaces",
        "projectsDir": "projects"
      }
    ]
  }
}
```

### What each field does

| Field | Meaning |
|---|---|
| `id` | Backend id shown in Admin → Storage |
| `mountPath` | Existing mounted directory inside the API/worker container |
| `workspacesDir` / `projectsDir` | Subfolders created under that mounted storage |

## Host mount examples

Use whatever host-level mount mechanism you prefer, as long as the final mounted path is visible to Meowbert.

### Example: mount NFS on the host

```bash
sudo mkdir -p /srv/meowbert/runtime/storage/mounted-shared
sudo mount -t nfs -o hard,noatime 10.0.0.25:/exports/meowbert /srv/meowbert/runtime/storage/mounted-shared
```

Then in Meowbert config, use:

```json
{
  "id": "mounted-shared",
  "type": "mounted",
  "mountPath": "/app/runtime/storage/mounted-shared"
}
```

### Example: mount OneDrive with rclone on the host

```bash
sudo mkdir -p /srv/meowbert/runtime/storage/onedrive-main
sudo rclone mount meowbert_onedrive:meowbert-data /srv/meowbert/runtime/storage/onedrive-main \
  --allow-other \
  --vfs-cache-mode writes \
  --vfs-cache-max-size 8G \
  --dir-cache-time 5m \
  --vfs-links \
  --daemon
```

Then in Meowbert config, use:

```json
{
  "id": "onedrive-main",
  "type": "mounted",
  "mountPath": "/app/runtime/storage/onedrive-main"
}
```

### Persisting host mounts

The best option depends on the storage type:

- **NFS / CIFS / block devices**: usually `/etc/fstab`
- **rclone mount**: usually a `systemd` service on the host

Meowbert only needs the final mounted directory to be present before API + worker start.

## Step 1: mount the storage on the host

Make sure the host path lives under the runtime bind source. For example, if your host runtime root is:

```txt
/srv/meowbert/runtime
```

then a mounted backend path could be:

```txt
/srv/meowbert/runtime/storage/onedrive-main
```

which becomes this inside the container:

```txt
/app/runtime/storage/onedrive-main
```

## Step 2: add the backend to `config/global.json`

Use the mounted-path backend type and point it at the container-visible path.

## Step 3: restart API and worker

After saving `config/global.json`, restart both services so they reload the backend definitions.

With Docker Compose:

```bash
docker compose up -d --build api worker
```

## Step 4: enable it in the admin panel

Open **Admin → Storage**.

From there you can:

- choose the new mounted backend as the **default** for future workspaces
- queue a **workspace migration** for any existing workspace

Changing the global default only affects **new** workspaces. Existing workspaces stay where they are unless you explicitly queue a migration.

## Troubleshooting

### Backend health says the mount is not active

Check:

- the host mount is actually mounted
- the mounted directory exists under the host runtime bind source
- the container path in `mountPath` matches the mounted host path
- API and worker both see the same bind-mounted runtime tree
- `mountpoint -q <mountPath>` succeeds from inside the API and worker containers
- the runtime bind mount uses shared propagation, such as `rshared`, so host mounts under the runtime directory propagate into running containers

### The path exists, but Meowbert still says it is not mounted

Meowbert checks that `mountPath` itself is a real mountpoint.

So if your real host mount is:

```txt
/app/runtime/storage
```

and your backend points at:

```txt
/app/runtime/storage/onedrive-main
```

that subdirectory will **not** count as a mountpoint.

Point `mountPath` at the actual mounted directory instead.

### I mounted OneDrive with rclone on the host. Does Meowbert still need rclone config fields?

No.

Those old in-app mounting fields are gone. Meowbert only needs the mounted directory path now.

### File writes or random-access edits behave badly on rclone mounts

Tune the **host-side** rclone command, not Meowbert config.

A good starting point is:

```bash
--vfs-cache-mode writes --vfs-cache-max-size 8G --dir-cache-time 5m --vfs-links
```

## Good defaults for first deployment

Start simple:

- keep `local-default` as the platform default first
- add one mounted backend such as `onedrive-main`
- verify it is healthy in **Admin → Storage**
- switch new workspaces over first
- migrate existing workspaces in batches

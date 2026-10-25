---
title: Storage mounts
summary: Make externally mounted storage visible to Meowbert and understand host and container paths.
---

# Storage mounts

## Overview

A mounted storage backend uses a filesystem mounted by your operating system. Meowbert uses the existing files; it does not create or manage the SMB, NFS or rclone mount.

There are two paths to keep straight: the folder on the **server host**, and that folder's path **inside API and worker containers**. Configure the container path in Meowbert. A desktop computer mounting the same backend has its own third path.

| Location | Example path for the same storage |
| --- | --- |
| Server host | `/srv/meowbert/runtime/storage/mounted-shared` |
| API and worker containers | `/app/runtime/storage/mounted-shared` |
| Mac mounting the exported backend | `/Volumes/Meowbert` |

Choose the backend ID and Meowbert configuration using [Storage Backends](./storage-backends). If the goal is desktop execution in an existing server workspace, also read [Local execution](/self-hosting/local-execution#server-hosted-workspace-storage).

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

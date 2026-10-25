---
title: Storage Backends
summary: Configure local or externally mounted workspace storage paths.
---

# Storage Backends

## Overview

A storage backend names a place where the server keeps workspace files. Each server-hosted workspace uses one backend; its Projects and task files live under that backend's root. The backend ID is the configuration's stable name, while the root path is the actual folder.

For example, a workspace on backend `mounted-shared` might use a root at `/app/runtime/storage/mounted-shared` inside the server containers. If a desktop task uses that workspace locally, the desktop must access the same backend, even if its local path is different.

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
- optional `workspacesDir` / `environmentsDir` subfolder names

Meowbert expects that path to already be mounted and visible from inside the API and worker containers.

That means the normal setup flow is:

1. mount the remote filesystem on the host
2. make sure that mounted directory is inside the host path that is bind-mounted into `/app/runtime`
3. point `storage.backends[].mountPath` at the corresponding **container path**
4. select the backend for new workspaces or migrate an existing workspace in **Admin → Storage**

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
        "environmentsDir": "projects"
      },
      {
        "id": "onedrive-main",
        "label": "Mounted OneDrive Runtime",
        "type": "mounted",
        "mountPath": "/app/runtime/storage/onedrive-main",
        "workspacesDir": "workspaces",
        "environmentsDir": "projects"
      }
    ]
  }
}
```

The JSON field `environmentsDir` retains the internal name for Project directories.

### What each field does

| Field | Meaning |
|---|---|
| `id` | Backend id shown in Admin → Storage |
| `mountPath` | Existing mounted directory inside the API/worker container |
| `workspacesDir` / `environmentsDir` | Subfolders created under that mounted storage |

## Choosing a default or moving a workspace

Changing the default backend affects **new workspaces only**. Existing workspaces keep their current backend unless you explicitly migrate them in **Admin → Storage**. A desktop task must use the backend of its existing workspace, even if the platform default has changed.

## External mount setup

See [Storage mounts](./storage-mounts) for NFS and rclone examples, persistent mounts, host/container path mapping, and mount-specific problems. Mounting the same backend for desktop execution is covered in [Local execution](/self-hosting/local-execution#server-hosted-workspace-storage).

## Good defaults for first deployment

Start simple:

- keep `local-default` as the platform default first
- add one mounted backend such as `onedrive-main`
- verify it is healthy in **Admin → Storage**
- switch new workspaces over first
- migrate existing workspaces in batches

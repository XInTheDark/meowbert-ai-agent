---
title: XFS Project Quotas
summary: Set up strict per-workspace storage limits on Linux hosts with XFS project quotas.
---

# XFS Project Quotas

If you want **hard** per-workspace storage limits, Docker container size limits are not enough for Meowbert.

Meowbert task sandboxes write into the real workspace and project paths through bind mounts, so the strict limit must live on the **actual host filesystem path** that backs workspace storage.

For Linux deployments, the recommended approach is:

- keep each workspace in its own storage unit directory
- keep projects nested under that workspace storage unit
- enforce a hard quota on that workspace directory with **XFS project quotas**

## What Meowbert expects

Meowbert can provision XFS project quotas for **local** storage backends when:

1. the local backend is configured explicitly in `storage.backends`
2. that backend includes `xfsProjectQuota`
3. the backend `workspacesRoot` lives on an XFS mount with project quotas enabled
4. `runtime.sandbox.resources.storageMb` is set

The hard XFS quota uses the same workspace limit value Meowbert already uses for preflight storage checks.

If you are migrating an existing install, use a **new XFS-backed workspaces path** first instead of mounting over the old one. Otherwise the old data becomes hidden under the new mount and Meowbert cannot relocate it for you.

If you are deploying with Coolify and need to move the whole runtime bind onto a new stable host path first, see [Coolify Runtime Storage & XFS Migration](/reference/coolify-runtime-storage).

Mounted-path backends are managed outside Meowbert, so any remote-cache limits for tools like `rclone mount` must also be managed outside Meowbert on the host.

## Example config

```json
{
  "storage": {
    "defaultWorkspaceBackendId": "local-default",
    "backends": [
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
    ]
  },
  "runtime": {
    "sandbox": {
      "resources": {
        "storageMb": 30720
      }
    }
  }
}
```

### What the XFS fields mean

| Field | Meaning |
|---|---|
| `mountPath` | The XFS mount inside the API/worker container where project quotas are enabled |
| `projectIdBase` | The minimum project id Meowbert should start allocating |
| `command` | Optional path/name override for `xfs_quota` |

## Recommended host setup

This is the safest setup when using the repo’s default Docker Compose layout and you already have existing local workspace data to migrate.

### 1. Prepare an XFS filesystem on the host

Create or choose a block device and format it as XFS:

```bash
sudo mkfs.xfs /dev/<your-device>
```

### 2. Mount it at the host path that backs workspace storage

With the default compose file, API and worker bind `./runtime` into `/app/runtime` with `rshared` propagation. If you are only doing local Docker Desktop development on macOS/Windows, you may need to override `MEOWBERT_RUNTIME_BIND_PROPAGATION=rprivate`, but this Linux/XFS setup expects `rshared`.

That means you can mount XFS **under** the runtime tree on the host, for example:

```bash
sudo mkdir -p /srv/meowbert/runtime/workspaces-xfs
sudo mount -o prjquota /dev/<your-device> /srv/meowbert/runtime/workspaces-xfs
```

Then make your compose bind source point at `/srv/meowbert/runtime` instead of the repo-local `./runtime`, or run compose from a checkout where `./runtime/workspaces-xfs` is that mounted XFS path.

The important part is:

- old local workspace path stays accessible, for example: `/srv/meowbert/runtime/workspaces`
- new XFS mount: `/srv/meowbert/runtime/workspaces-xfs`
- container path for the XFS backend: `/app/runtime/workspaces-xfs`
- config `workspacesRoot`: `/app/runtime/workspaces-xfs`
- config `xfsProjectQuota.mountPath`: `/app/runtime/workspaces-xfs`

This lets Meowbert copy existing workspace roots from the old local path into the new XFS-backed path during the admin migration.

If this is a brand new deployment with no existing local data, you can mount XFS directly at the final workspace path instead.

### 3. Persist the mount

Add an `/etc/fstab` entry with project quotas enabled:

```fstab
/dev/<your-device>  /srv/meowbert/runtime/workspaces-xfs  xfs  defaults,prjquota  0  0
```

Depending on distro, `pquota` may be accepted as an alias. `prjquota` is the clearest choice.

### 4. Install host tools

The host should have XFS tooling available:

```bash
sudo apt-get install -y xfsprogs
```

Meowbert’s API and worker containers also need `xfs_quota` available. The Dockerfiles in this repo now install `xfsprogs`.

### 5. Verify project quota support

On the host:

```bash
sudo xfs_quota -x -c 'state -p' /srv/meowbert/runtime/workspaces-xfs
```

Inside the API or worker container, the equivalent path should also work:

```bash
xfs_quota -x -c 'state -p' /app/runtime/workspaces-xfs
```

You want project quota accounting and enforcement to be available before running the Meowbert migration.

## Recommended migration order in Meowbert

After the host mount and config are ready:

1. restart API + worker
2. open **Admin → Migrations**
3. run **Nest projects under workspace storage units**
4. run **Migrate local workspaces to XFS storage units**

That order matters.

The first migration moves legacy project roots under each workspace storage unit. Without that, a workspace quota would only cover the workspace root and miss older project data.

## What the XFS migration actually does

When you run the XFS migration, Meowbert:

- moves each local workspace root onto the configured managed XFS path when needed
- assigns a stable `storage_project_id` to each workspace on the configured local backend
- applies that project id to the workspace storage unit directory
- sets a hard XFS quota based on `runtime.sandbox.resources.storageMb`

New workspaces on that backend will also get quotas automatically when their storage root is initialized.

## Mounted-path backends and cache limits

If you mount something like OneDrive with `rclone mount` on the host, Meowbert now treats that as a normal externally mounted path.

That means any cache path, cache quota, or mount tuning for that remote is a **host-side concern**, not a Meowbert config feature.

If you want to cap a host-side rclone cache with XFS, do it in the host mount setup itself and keep that cache directory outside Meowbert's storage backend config.

## What this does **not** do

This does **not** convert a remote mounted filesystem into a hard-quota filesystem.

XFS project quotas only apply to local filesystem paths that Meowbert controls directly.

## Notes

- Keep Meowbert’s own storage checks. They still provide better preflight UX and admin visibility.
- XFS quota failures show up as normal filesystem write failures (`ENOSPC`) once the hard limit is reached.
- If you already had old project paths under a separate legacy tree, run the project nesting migration first.
- A helper host script now exists at `scripts/setup-xfs-storage.sh` to prepare workspace XFS mountpoints.

## References

- Red Hat: [Limiting storage space usage on XFS with quotas](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/managing_file_systems/limiting-storage-space-usage-on-xfs-with-quotas)
- `xfs_quota` reference: [man7 xfs_quota(8)](https://man7.org/linux/man-pages/man8/xfs_quota.8.html)

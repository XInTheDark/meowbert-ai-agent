# Local Execution: Planning & Specs

Status: Milestones 0–4 implemented in code. Local execution is disabled by default. Automated tests cover the HTTP lifecycle, storage visibility, Windows paths/transport, native host commands and fencing, Computer Use arbitration, device file workflows, and PostgreSQL workspace/tombstone/relink contracts. Live host browser and Computer Use permissions, Docker Desktop network shares, and packaged-app acceptance on macOS/Windows still require the corresponding hosts and published multi-architecture image. Milestone 5 is not implemented.

- Part I explains what we are building and why.
- Part II specifies the contracts between the pieces.
- Part III lists code changes, milestones and acceptance tests.

For implementers: build it in the milestones of section 22, one phase per change, each passing `npm run test`, `npm run lint` and `npm run build`. Where this doc names an existing function or pattern to copy, copy it rather than inventing a parallel mechanism. Where it leaves a detail open, pick the simplest option that keeps the invariants in section 17 and the AGENTS.md contracts, and record the choice in section 24.

---

# Part I: Planning

## 1. Summary

A task can run **in the cloud** (default, today's behavior) or **locally** on the user's machine through the Meowbert desktop app. A local task runs the same agent loop as a cloud task, with the user's own shell, browser and screen, on the same workspace files as every other task.

Two decisions make this work:

1. **The worker is split in two.**
   - **Control plane** (server only). Owns Postgres, Redis, the queue, admission, recovery, budgets, billing, delivery, scheduling, swarm coordination, the memory index, connectors and model credentials.
   - **Run executor** (server or desktop). Runs one agent run: builds the prompt, calls the model, dispatches tools, reports progress. It talks to the control plane only through a scoped **Run API**. It never holds database, Redis or model provider credentials.
2. **Every workspace has a file host, and runs go where the files are.** Files are never moved through the API.
   - A **server-hosted workspace** (today's kind) keeps its files on a server storage backend. Server workers see it at their configured path. A desktop executor can run its tasks too, if the user's machine sees the same storage and the user sets its **mount path** in the desktop app. There is one copy of every file, so there is nothing to sync. Each task picks Cloud or Local.
   - A **device-hosted workspace** keeps its files in a **folder the user chooses** on one device. Only that device runs its tasks. The server stores its tasks, history and settings, never its files.

Cloud workers become run executors that happen to sit next to the control plane. There is one executor code path, not a cloud path and a local fork, and one storage layout, resolved from whichever root the executor has.

A local task runs **in the same sandbox image as the cloud, in Docker on the user's machine**, by default, so every skill and tool behaves as it does in the cloud. **Host mode** is the option for devices without Docker or tasks that need the machine itself: commands run directly on the host with the user's full authority (section 8). In both modes, Computer Use and the user's own Chrome are available as host tools. The first local task asks the user to download the sandbox (section 8.3).

## 2. Goals and non-goals

Goals:

- Per-task choice between Cloud and Local in the desktop composer for server-hosted workspaces. Cloud stays the default. The web app never offers Local.
- Device-hosted workspaces whose root is a folder the user picks, runnable only on that device.
- A local task sees what a cloud task sees: project folder, Project Context, memory, task directory, inputs and outputs, at the same relative paths.
- A local task runs in the cloud's sandbox image on the user's machine by default, with every skill, and can reach the machine itself (Computer Use, the user's Chrome, a host shell) through host tools.
- Devices without Docker, or tasks that need it, can use host mode instead.
- A local task looks like any other task everywhere: same history, streaming, follow-ups, notifications. It can be viewed from the web app; it can only run on its device.
- A modified desktop app cannot read other users' data through the Run API, spend beyond a bounded amount of the user's budget, or obtain model provider keys.
- The worker ends up with a clean boundary: run execution on one side, persistence and coordination on the other.

Non-goals:

- Any file sync, upload or mirroring mechanism.
- Setting up mounts for the user. Meowbert verifies them; the user or operator creates them.
- Restricting host mode. A host-mode task can do anything the user can.
- Moving a running task between Cloud and Local, or failing over to the cloud when the device is offline.
- Agent Swarm, subagents and Project Master in local runs, and read-only thread tasks in host mode (section 19).
- Moving a workspace between a server and a device, or sharing a device-hosted workspace.
- Bring-your-own model keys in the desktop app.

## 3. Why the worker is coupled today

Workers already scale horizontally: any number of BullMQ consumers pull from `TASK_QUEUE_NAME`. They are distributed through shared state: every worker host connects to the same Postgres and Redis and mounts the same storage. From the worker service in `docker-compose.yml`, each one holds:

- Postgres credentials. The worker issues about 165 direct `query(...)` calls across about 50 files, and about 170 transactions and row locks.
- Redis, for the queue, task-event pub/sub and the desktop computer broker.
- Meilisearch and LanceDB for memory and search, plus provider keys (`OPENAI_API_KEY`, ChatGPT OAuth tokens).
- The runtime volume `/srv/meowbert/runtime`, or a `mounted` storage backend (`packages/shared/src/storage-backends.ts`).
- `/var/run/docker.sock`, `SYS_ADMIN` and FUSE, to start sandboxes and source mounts.

Storage generalizes: a desktop that sees the same storage is like a second worker host. The database, Redis and credentials don't: handing them to every desktop would expose every user's data. So the split cuts only those.

Most of the database queries belong to coordination loops started in `apps/worker/src/index.ts` (dispatch, recovery, retries, time limits, cleanup, archive, schedules, swarm, wake loops, delivery, email, memory synthesis). Those stay on the server unchanged.

## 4. The run path today

`runAgentJob` in `apps/worker/src/services/agent/index.ts` is the whole run:

1. `prepareAgentRunContext` (`runtime.ts`): loads the task snapshot, resolves provider and model routing, resolves directories, mints GitHub and source env, starts the sandbox, mounts sources, starts the memory watcher and cancellation monitor, marks the dispatch running.
2. `initializeAgentExecution` (`setup.ts`): sets task status, builds the system prompt and prompt envelope, loads Project Context and `MEMORY.md`, resolves billing and run capabilities, prepares swarm or lane state, may generate a title.
3. `runAgentStepLoop` (`loop.ts`): model turns through `createModelResponseWithRetry`, tool dispatch through `dispatchResponseOutput`, context checkpoints and compaction, `appendMessage`, `emitTaskEvent`.
4. `finalizeAgentRun` (`finalize.ts`): parks for subagent mail or lanes, `completeTaskRun`, wakes the run delivery loop.
5. `handleAgentRunFailure` and `prepared.cleanup`.

Each step mixes pure execution, persistence, and machine access. The split separates these. File access stays plain filesystem calls against storage paths.

## 5. Shape of the split

```
              control plane (server)                      run executor
  ┌──────────────────────────────────────────┐     ┌───────────────────────────┐
  │ Run API (/runs/:id/...)  ◄────────────────┼─────┤ RunControl client         │
  │ admission / dispatch / recovery / retry   │     │ agent loop                │
  │ model proxy  ─ reservations, keys, policy │◄────┤ tool dispatch             │
  │ platform tool host                        │◄────┤ MachineHost:              │
  │ Postgres, Redis, Meilisearch, LanceDB     │     │   cloud → server Docker   │
  └─────────────────────┬────────────────────┘     │   local → device Docker,  │
                        │                           │     or the host           │
                        └──── workspace storage ───┴───────────────────────────┘
```

The executor depends on three interfaces:

- **`RunControl`**: everything the run path does with Postgres and Redis (load the run, persist messages and events, checkpoint, heartbeat, complete). `DbRunControl` in-process for cloud workers, `HttpRunControl` over the Run API for devices.
- **`ModelGateway`**: every model call the run makes, including auxiliary ones (section 12). `DirectModelGateway` for cloud workers, `ProxyModelGateway` for devices.
- **`MachineHost`**: shell, attached processes, source mounts. `SandboxMachineHost` wraps `DockerSandboxHandle` and runs against any Docker daemon: the server's for cloud runs, Docker Desktop's for local sandbox runs (`DockerSandboxManager` already honors `DOCKER_HOST`). `HostMachineHost` runs commands directly on the desktop for host mode.
- **Host tools** (Computer Use, the user's Chrome, the host shell) are separate from `MachineHost`, so a sandboxed run can still use them (section 8.2).

Tools are classified by where their state lives (section 13), not just where they run.

---

# Part II: Contracts

## 6. Storage

### 6.1 File hosts

Each workspace has a **file host**, set at creation and never changed:

- `{ kind: "server", backendId }`: today's workspaces, on a server storage backend (the existing `storage_backend_id`).
- `{ kind: "device", deviceId }`: files in a folder on one device. The server knows which device, not the path.

Projects inherit their workspace's file host. Three rules follow:

1. **Runs go where the files are.** A task's execution target must be able to reach its workspace's files: a server-hosted workspace runs on a cloud worker or on a device with a verified root for its backend; a device-hosted workspace runs only on its device. The API enforces this at task creation, follow-up and schedule creation.
2. **File operations run where the files are.** For server-hosted workspaces, the API's file services work as today. For device-hosted workspaces, the desktop app's main process performs them.
3. **Server features that need workspace files are decided in one place.** `workspaceFileFeatures(fileHost)` in shared says which features a workspace has. The web app hides what's off, `availability.ts` drops the matching tools, server loops skip the workspace, and request paths that would touch files are gated by it (section 7.2).

Both kinds use the same layout below the root. Only the root differs.

### 6.2 Supported storage arrangements

For a server-hosted workspace run from a device, the device must see the backend. Arrangements, in milestone order:

1. **Same machine** (milestone 1): the server runs on the user's machine; the mount path is the backend root itself. Same disk, same consistency as the cloud.
2. **Share from the server host** (milestone 2): the server host exports the backend over SMB or NFS and the device mounts it. Close-to-open consistency for named files; directory listings may lag.
3. **Independent access to the same remote** (best effort, not supported): for example, the server's backend is an rclone mount of a Google Drive and the device reaches the same Drive on its own, with rclone or Google Drive for desktop. Each side has its own cache, so visibility and durability depend on two caches. Allowed, documented as unsupported. For Google Drive for desktop specifically:
   - The mount path is the backend root folder inside Drive for desktop, which must be in the user's own My Drive (a folder only "shared with me" doesn't appear). The marker and probe (section 6.3) catch a wrong folder.
   - Drive for desktop uploads in the background, so the server sees device writes late: artifacts stay "syncing" longer, and runs whose inputs came from the web wait for them (section 6.6).
   - Concurrent edits from a cloud task and a local task can produce conflict copies instead of last-writer-wins.
   - Use **Mirror files**, not **Stream files**. Streamed files are placeholders until opened, and whether Docker Desktop's file sharing downloads them on read is untested, so sandbox mode may see empty files.
   - Google Docs, Sheets and Slides appear as `.gdoc`-style shortcut files on the device, but as exports or links through the server's rclone mount. Agents on the two sides see them differently.

In sandbox mode the root must also be shareable into Docker Desktop's VM, since the sandbox bind-mounts it. Folders under the user's home are shared by default; other paths must be added in Docker Desktop's file sharing settings. A network mount must pass both the host marker/write probe and the Docker bind-mount probe before it is advertised as ready. The opt-in desktop network-storage integration test exercises named-file reads and writes on an actual mount; run it for each host/share combination. Host mode is not available until milestone 3.

The guarantee Meowbert relies on is narrow: **a named file the executor has closed is eventually visible to the server by name**, with a delay bounded by the mount's settings. Nothing relies on listings being consistent.

### 6.3 Verifying a root

Every root has a marker file, so a device checks it with named-file operations, never a walk:

- **Server backends**: `.meowbert-storage.json` at the backend root, with the backend id and a random install id. The server writes it once at startup if it's missing.
- **Device-hosted workspaces**: `.meowbert-workspace.json` in the chosen folder, with the workspace id, written by the desktop app at creation.

At each claim, the device reads the marker (identity) and writes then deletes `.meowbert-probe-<deviceId>` next to it (connectivity and writeability). In sandbox mode the probe runs inside the run's container, which also proves the bind mount works. A cached marker alone doesn't prove the mount is live; the probe does. Failure means the device can't take the run (section 9).

### 6.4 Path mapping

Task roots are relative in the database (`tasks.task_root_path` is `.meowbert/task-runs/<id>`). **Workspace and project roots are not**: they're persisted as canonical absolute server paths (`resolveCanonicalStorageRoot` in `packages/shared/src/storage-root-resolution.ts`), and a configured root can differ from the managed one derived from IDs. So paths are never re-derived from IDs for server-hosted workspaces.

- **Server side of the boundary.** The bootstrap converts each persisted root to a path relative to the backend's canonical root (`path.relative`), and refuses if the result escapes the root (starts with `..` or is absolute). A workspace or project whose root lies outside its backend can't run locally: the API rejects device targets for it at task creation, with a reason.
- **Device side.** The executor joins each relative root with its mount path, resolves symlinks, and refuses if the result isn't inside the mount.
- **Device-hosted workspaces** have no configured roots: their layout is always derived from IDs under the chosen folder, and the server doesn't persist absolute roots for them.
- **Reporting back.** Paths the executor sends (artifacts) are relative to the task root, as today.
- **Prompt paths** are the executor's absolute paths. If the root moves (the user changes the mount path, or relinks a device-hosted workspace), the next run uses the new paths: the prefix changes once (one cache miss) and setup adds a note through `appendPromptEnvelopeDelta` that the workspace moved from the old path to the new one, so earlier messages that mention old paths still make sense.

### 6.5 What a local task gets

In a server-hosted workspace, a local task gets the same files as a cloud task: `$ENV_ROOT` with the same write rules, Project Context (the executor runs `loadProjectContextPromptData` on its own `$ENV_ROOT/context`; notes come from the bootstrap), memory files and `.thinking`, the task directory, inputs, artifacts, and earlier tasks' outputs. In a device-hosted workspace it gets the same from the chosen folder, minus the server features in section 7.

### 6.6 Inputs and outputs

**Inputs.** The API records size and SHA-256 when it saves an upload. The bootstrap lists the run's inputs with both. The executor stats each named path, then hashes it (it reads the file anyway). If a file is missing or doesn't match after 30 seconds of retries, the device releases the claim with "waiting for storage" and the run goes back to waiting (section 9). It doesn't fail.

**Outputs.** An artifact is published in two steps:

1. The executor closes the file, computes its size and SHA-256, and records it through `POST /runs/:id/artifacts` as `pending`.
2. The server checks the named file by `stat` and size, and marks it `available`. If it isn't visible yet, a server loop rechecks the named paths with backoff for up to 30 minutes, then marks it `missing`. It hashes only when the size matches and only once.

Run completion doesn't wait for publication. The UI shows pending artifacts as "syncing", and later tasks are only pointed at `available` ones (`loadTaskOutputFiles`).

**Memory.** After a device run completes, the server syncs the workspace's memory index (`syncWorkspaceMemoryNow`) right away and again at +1 and +5 minutes, so a late-visible write isn't missed. It also syncs before running `memory_search` for a device run. Memory is a small directory Meowbert owns, so these syncs are allowed.

### 6.7 Machine-local state

- **Scratch** lives under `<userData>/scratch/<workspaceId>/<taskId>` on the device.
- **Shared dependencies** contain native packages, so they're per platform. `.meowbert/shared` stays the directory for `linux-x64`, which is what cloud sandboxes run today. Any other platform uses `.meowbert/shared-<platform>-<arch>`: `shared-linux-arm64` for the sandbox on an Apple Silicon Mac, `shared-darwin-arm64` for host mode there. The prompt names the right one.
- **Persistent shells** live in the run's container in sandbox mode, as in the cloud, and as host processes in host mode. Both end when the desktop app quits.
- **Cleanup** of device-side state (scratch, and in device-hosted workspaces the files `task-cleanup.ts` and `environment-file-cleanup.ts` remove on a server) uses durable tombstones (section 14.4), so an offline device still learns about deletions later.

## 7. Device-hosted workspaces

### 7.1 Lifecycle

- **Creation.** In the desktop app, "On this device" with a folder picker. The app calls the API with `fileHost: { kind: "device", deviceId }`, then writes the marker and the base layout. The server skips storage root creation and quotas.
- **Running tasks.** Every task's execution target is the workspace's device, set by the API. The composer shows no Cloud / Local control. Schedules and recurring runs target the device too and wait while it's unavailable.
- **Files in the UI.** All file features go through one `WorkspaceFiles` adapter in the web app: HTTP for server-hosted workspaces, IPC to the desktop main process for device-hosted ones. Elsewhere, file views say "Files are on <device>".
- **Relink.** A new device id (reinstall, new computer): the owner picks the folder on the new device, the app reads its marker, and `POST /workspaces/:id/relink` points the workspace at the new device. Relink first revokes the old device's leases and waits out the reclaim delay (section 10), so the old device can't still be running something. Pending runs then go to the new device.
- **Deletion** never deletes the folder; the app says where it is.
- **Privacy.** Files stay on the device, but what the agent reads goes to the model through the server and the conversation is stored on the server. The UI says so at creation.

### 7.2 Workflow inventory

The root guards (below) are a safety net, not the mechanism. Every request path that touches workspace files is listed and gated by `workspaceFileFeatures` or moved to the device, so normal use never hits a guard. Producing and checking this list is part of milestone 4. Known entries:

| Path | Today | Device-hosted |
|---|---|---|
| Task creation, follow-up (`environment-for-user.ts` calls `ensureWorkspaceStorageRoot` unconditionally) | creates storage root | skip; the executor ensures task dirs at run start (`ensureTaskWorkspace`) |
| Uploads (`save-uploaded-file.ts`, `resolveTaskInputsDirForEnvironment`) | writes to server | desktop writes via IPC, sends size and hash to the API |
| File browsing, preview, download, delete, create (`services/files/*`, `workspace-files.ts`, `environments/file-routes.ts`) | server fs | desktop IPC |
| Project Context page, memory page (`memory-routes.ts`, `workspace-memory.ts`) | server fs | desktop IPC |
| `memory_search`, memory index, memory reindex | server | off (agent browses `.memory`) |
| Memory synthesis (writes its delta as a task input on the server) | server | off |
| Canvas (`project-canvases.ts`, `canvas-file-response.ts`, canvas tools) | server | off |
| Terminal sessions (`persistent-shell-sessions.ts`) | sandbox | off |
| Synced linked sources (`folder-sync.ts`) | server fs | off |
| Inbound connectors saving attachments (email, Discord, Telegram) | server fs | off |
| Task forks copying files (`task-forks.ts`) | server fs | conversation only |
| Task inline files (`task-inline-files.ts`) | server fs | desktop IPC |
| Cleanup on archive/delete | server fs | device, via tombstones |
| Storage usage, storage migration, XFS quotas | server | off |
| Members and invites | | off (single user) |

Implementation inventory (milestone 4): API request gates run before file, memory, canvas, shell, membership and source-attachment handlers; source connection metadata and network reads remain available. Task/project creation skips server provisioning. JSON file operations and binary previews use desktop IPC; native downloads and inline media use device delivery. Desktop operations reauthorize their scope through the metadata-only location endpoint and verify the folder marker. Memory refresh/reindex/synthesis and cleanup loops skip device roots; cleanup records durable named-path tombstones. Forks copy conversation only. Storage migration, usage, linked-source attachment and inbound attachment persistence are gated in their owning services. Shared feature policy also hides unavailable UI controls. TEST_LOCAL_WORKSPACE_DATABASE_URL enables an isolated-schema PostgreSQL regression test for host invariants, archive tombstones and delayed relink recovery.

**Guards.** The root helpers (`ensureWorkspaceStorageRoot`, `ensureEnvironmentRootById`, `resolveTaskInputsDirForEnvironment`, and the worker's `resolveTaskWorkspaceRoot` / `resolveTaskEnvironmentRoot`) throw `WorkspaceFilesOnDeviceError` for a device-hosted workspace. Hitting one is a bug in the inventory, logged as an error and returned as a 409.

## 8. Machine modes

A local run uses one of two modes, chosen per task in the composer next to Cloud / Local, with a per-device default. **Sandbox is the default.**

### 8.1 Sandbox mode (default)

- Commands, files, persistent shells, code mode and skills run in the same sandbox runtime image as the cloud, started by the desktop app in the device's Docker (Docker Desktop on macOS and Windows) through `SandboxMachineHost` and the existing `DockerSandboxManager`. Same mounts (`buildTaskSandboxMounts`, including read-only mounts for thread tasks), same network policy (`getSandboxNetworkEnabled`), same skills (baked into the image under `/app/skills`).
- Resources come from the server's sandbox config, capped by a device setting so a laptop isn't overcommitted.
- The container runtime is Docker Desktop's default (`runc` inside its VM); `sandbox.runtime` (for example gVisor's `runsc`) is a server setting and doesn't apply to devices.
- Isolation is the same kind as the cloud's: the container can reach only what's mounted. That's why read-only thread tasks are allowed in sandbox mode.

### 8.2 Host tools

Some things only exist on the machine itself. They're tools the agent calls next to the sandbox, not part of it, and each one is turned on per device:

- **Computer Use**: foreground control of the real screen (section 15).
- **Your Chrome**: Browser Use driving the user's installed Chrome with a persistent Meowbert profile, for sites that need the user's logins (section 15). The sandbox's own headless Browser Use stays available as in the cloud.
- **Host shell**: `host_shell` runs one command on the host as the user, for Mac apps and the user's own command-line tools. Off by default. Turning it on requires the same consent as host mode (section 8.4), since it has the same authority.

### 8.3 Getting the sandbox

The device needs Docker and the server's sandbox image.

- **Which image.** Cloud workers record the sandbox image they run (`MEOWBERT_SANDBOX_RUNTIME_IMAGE`) by repository and digest when they start (`assertImageAvailable` already inspects it). The device config the API returns includes that reference, so devices pull the same release the cloud runs, by the digest of its multi-architecture manifest.
- **First use prompt.** The first time the user picks Local (or creates a device-hosted workspace), and the image isn't on the device, the desktop app asks: "Local tasks run in the Meowbert sandbox. Download it now? (<size>)", with the size from the registry manifest, and the buttons Download, Use host mode instead, and Cancel. The download shows progress in the app. Tasks that are waiting show "Downloading the sandbox on <device>".
- **No Docker.** If Docker isn't installed or not running, the prompt says so, with a link to install Docker Desktop, and offers host mode instead.
- **Updates.** When the cloud's image digest changes, the device pulls the new one in the background (on by default after the first download, a device setting). A run needs the digest the server names; while it downloads, runs wait with "Updating the sandbox on <device>". Old images are removed after the new one is in use.
- **Unpullable images.** A self-hosted server running a local-only image (for example `meowbert-sandbox-runtime:local`) has no digest a device can pull. Sandbox mode is unavailable on devices for that server unless the user loads the image into their own Docker; the settings say so and offer host mode.
- **Architecture.** The publish workflow now builds `linux/amd64` and `linux/arm64` (`.github/workflows/publish-sandbox-runtime.yml`). Apple Silicon Macs need a `linux/arm64` build, or they'd run it under emulation. Adding `linux/arm64` to the publish workflow, and checking every architecture-specific step in `apps/sandbox-runtime/Dockerfile` (Typst already handles both), is part of milestone 1.

### 8.4 Host mode

For devices without Docker, or tasks that need the machine directly:

- Commands run on the host through `HostMachineHost`, as the user, in the task directory.
- **Full authority, with consent.** File-tool path checks can't constrain a shell command, an interpreter, a subprocess or a Computer Use action, so host mode doesn't pretend to restrict anything. Turning it on (or `host_shell`) requires explicit consent on the device: "Tasks in host mode can run any command as you on this computer and read or change any of your files." Per device, recorded on the device registration, revocable. Path checks stay as guard rails against mistakes.
- **Read-only thread tasks** aren't available, since nothing enforces read-only. The API refuses them in host mode.
- **Skills**: only those marked `host: "supported"` (section 20). The others need tools only the image has (LibreOffice, pandoc, Typst, poppler, the pinned Python packages), and AGENTS.md rules out installing them at runtime.
- Later hardening, if wanted: a macOS Seatbelt profile limiting writes to the task's roots. Nothing here depends on it.

## 9. Admission and device readiness

Existing admission counts both `admitted` and `running` dispatches against workspace and project limits (`listEnvironmentDispatchCounts` in `task-run-dispatch.ts`). A device run waiting for a closed laptop must not hold a slot.

- **Eligibility.** A device run stays `pending` and is skipped by admission until its device is **ready**: its run stream has been connected within the last 30 seconds, its executor version is supported, it has a verified root for the run's file host, it has free capacity, and its mode is ready: for sandbox mode, Docker is running and the image digest the server names is present; for host mode, consent is on. Pending runs don't count against limits.
- **Device capacity.** Each device has a maximum number of concurrent local runs (default 2, a device setting). Admission counts the device's `admitted` and `running` runs against it, alongside the workspace and project limits.
- **Claim window.** An admitted device run must be claimed within 60 seconds, or it goes back to `pending`. A claim the device refuses (marker or probe failed, inputs not visible) also returns it to `pending`, with the reason stored for the task header.
- **Waiting.** The task header shows why a run is pending: "Waiting for <device>", "Storage not available on <device>", "Docker isn't running on <device>", "Downloading the sandbox on <device>", "Update the desktop app", or "<device> is busy". A run pending for its device for 24 hours fails (configurable). The task time limit keeps applying.
- **Recovery loops** (`recoverQueuedTaskRunsOnce`, `recoverRunningTaskRunsOnce`) skip device runs; leases (section 10) replace them.

## 10. Leases and fencing

The server and the device must never both believe they own a run, including the device's processes, not just its API calls.

- **Timing.** The device heartbeats every 10 seconds. A lease lasts 60 seconds from the last successful heartbeat. The server reclaims an expired lease only after a further 30-second grace, so 90 seconds after the last heartbeat.
- **Self-fencing.** If the device hasn't renewed successfully for 30 seconds, it fences itself: it stops starting tools and model calls, kills every process it started for the run, closes the run's browser contexts, and releases Computer Use. It then discards the run's local state. 30 seconds is well inside the 90 the server waits.
- **Sandbox mode** fences by stopping the run's container, which ends everything in it. At app start, the device stops containers labeled with runs it doesn't hold a lease for (the existing `listManagedContainers` labels, as `sandbox-orphan-cleanup.ts` does on the server).
- **Host mode and host tools: process ownership.** Every host command runs in its own process group. The device records the run's process group ids in `<userData>/runs/<runId>.pids`, kills groups with `SIGTERM` then `SIGKILL` after 5 seconds, and at app start kills any groups left in pid files before it claims anything. So processes don't survive an app crash into a reclaimed run.
- **Sleep and network loss.** On wake or reconnect, the device checks its leases before doing anything. A lease it can't confirm is treated as lost and fenced.
- **Relink and device revoke** revoke leases immediately and then wait the full reclaim delay before reassigning.
- **Epochs.** Each claim gets a new lease epoch, and every Run API write carries it. A write with a stale epoch is rejected.

### 10.1 Actions with unknown outcomes

A recovered run can't know whether a tool call that was in flight finished. Replaying a command that pushed a commit or submitted a form would do it twice.

- Before executing a tool call, the executor records it as started (`POST /runs/:id/tool-calls`, part of section 11). The result is recorded when it finishes.
- On recovery, any tool call recorded as started with no result gets a synthetic result: "The run was interrupted while this was running, so its outcome is unknown. Check its effects before repeating it." It is never replayed automatically.
- This applies to cloud runs too, once they go through `RunControl`. Today's cloud recovery has the same gap.

## 11. Run API semantics

New routes under `apps/api/src/routes/runs/`, domain logic in `apps/api/src/services/runs/`. Run routes are authenticated with a run lease token (a scoped ticket like `signInternalScopedAccessTicket`), bound to `userId`, `taskId`, `runId`, `deviceId` and the lease epoch. There are no file endpoints.

### 11.1 Retries and deduplication

Lease epochs don't cover retries within one epoch: a `/messages` call that commits but loses its response would append twice when retried.

- **Operation ids.** Every mutating call carries an `operationId` the executor generates before the first attempt and reuses on every retry.
- **Durable dedup.** `run_api_operations(run_id, operation_id, request_hash, response_json, created_at)` with a unique key on `(run_id, operation_id)`. The operation is recorded before the mutation runs and its response after (section 24, decision 17); a retry with the same id returns the stored response, or "outcome unknown" if the first attempt never finished. A retry with the same id and a different request hash is rejected.
- **Messages** carry `expectedLeafId`. If the branch leaf has moved, the server returns 409 with the current leaf, and the executor reloads instead of appending on the wrong branch.
- **Events** carry a per-run sequence number assigned by the executor. The server ignores duplicates and late arrivals, so events publish in sequence order (decision 18).
- **Completion.** `complete` and `fail` are idempotent: a repeat returns the same final response. `complete` runs `completeTaskRun` and records pending delivery in one transaction, as today.
- **Retention.** Operation rows are deleted a day after their run finishes.

### 11.2 Which calls can be retried

| Kind | Examples | On a lost response |
|---|---|---|
| Idempotent by operation id | messages, events, checkpoints, artifacts, tool-call start/result, complete, fail | retry with the same id |
| Read-only | bootstrap reload, heartbeat, read-only platform tools (`memory_search`, web search, connector reads) | retry freely |
| Side-effecting platform tools | scheduling, creating subtasks, connector sends | retry with the same id; the server records the operation before the external effect, so a retry after a server crash mid-effect returns "outcome unknown" (section 10.1) instead of repeating |
| Model calls | `/model/responses` | not retried by the client after the stream starts; see section 12 |

### 11.3 Routes

Device routes (desktop session auth):

- `POST /devices`, `PATCH /devices/:id`, `DELETE /devices/:id`: register, update capabilities, consent and verified roots; revoke.
- `GET /devices/:id/runs/stream`: SSE stream of runs admitted for this device. Also the readiness signal for admission.
- `POST /runs/:id/claim`: returns the lease token, epoch and bootstrap (section 14). Two claims for one run: the first wins, the second gets 409.
- `GET /devices/:id/tombstones`, `POST /devices/:id/tombstones/ack` (section 14.4).

Run routes (lease token): `heartbeat`, `events`, `messages`, `checkpoints`, `tool-calls`, `artifacts`, `model/responses`, `tools/:name`, `live-folders/:linkId/rclone-config` (milestone 5), `complete`, `fail`.

As built in milestone 0, each `RunControl` method is one call: `POST /api/runs/:id/call/:method`, where `method` names the interface member (`control.appendMessage`, `context.recordItems`, `platform.createSubtask`, `control.heartbeat`, ...), with `{ operationId, args, expectedLeafId?, seq? }`. Model requests go to `POST /api/runs/:id/model/responses`. The method list, which methods write, and the error codes are in `packages/shared/src/run-api.ts`. The API checks the lease token and forwards the call to the worker that holds the run (section 24, decision 15).

## 12. Model proxy

The local executor sends every model request to `/runs/:id/model/responses`. The server owns the upstream connection.

- **Request allowlist.** The server builds the provider request itself from a fixed set of client fields: input items, function tools (which must match the run's resolved tool set), `tool_choice`, reasoning effort within the route's range, and a `purpose` (below). The server sets the model from the run's route, `max_output_tokens`, storage and service tier, and adds hosted tools (such as provider web search) only from run policy. Any other field is rejected.
- **Reservations.** Before forwarding, the server reserves the request's maximum cost (input tokens counted on the server, plus `max_output_tokens`, at the route's prices) against the user's remaining allowance, in one row-locked transaction on the usage ledger. A request whose reservation doesn't fit is rejected. After the response, the reservation is settled to the provider-reported usage (`parseModelResponseUsage`, `resolveRunUsageBilling`). Overspend is bounded by the error in the input-token count, and concurrent requests can't all pass the same balance check.
- **Concurrency.** One in-flight model request per run (the loop is sequential), and a per-user limit across runs.
- **Disconnects.** If the device disconnects mid-stream, the server cancels the upstream request and settles from the usage the provider reports for what was produced (or the full reservation if none is reported). Accounting never depends on the client finishing.
- **Auxiliary calls.** Every model call in the run path goes through `ModelGateway` with a `purpose`: `turn`, `compaction` (context compaction and context-management summaries), `title` (`maybeAutoGenerateTaskTitle`), `web_search` (`runClaudeWebSearch`) and any others the phase 2 inventory of `createModelResponse` and provider-client callers finds. Each purpose has its own server-side policy (allowed models, output limit) and is billed to the run like today.

### 12.0 As built in milestone 0

- **Allowlist.** Accepted body fields: `input`, `instructions`, `include`, `store` (false only), `tools`, `tool_choice`, `parallel_tool_calls`, `prompt_cache_key`, `prompt_cache_options`, `user` and `max_output_tokens` (at most the context window). Any other field must be one of the route's own payload fields with the route's value, so reasoning effort and service tier come only from the route. `model` is always rejected; the gateway sets it from the route and purpose. Tools must be `function` or `custom`, except hosted `web_search` on turns of runs allowed to search. Only the cache-affinity and Meridian headers pass.
- **Reservations.** `user_usage_reservations`, written under a row lock on the user. The bound is the counted input plus `max_output_tokens`, or, when the request sets none, every output token the context window leaves room for. Agent turns don't set an output limit (a small one starves reasoning), so the server doesn't add one; the context window bounds them instead. Reservations count against every limit the user's plans set, rolling windows included, and stop counting after an hour if their request never settles.
- **Disconnects.** The upstream request is aborted, and a request abandoned this way is billed at its reserved maximum, since the provider reports no usage for it.
- **Not built yet.** Checking that function tools match the run's resolved tool set (the executor loads skills and MCP tools on demand, so the server would need that state too), and the per-user limit across runs. Both are open questions in section 24.

### 12.1 Model-call inventory

Every model call on the run path, as of milestone 0 phase 2. Each one goes through `ModelGateway.create` with its purpose; nothing on the run path builds a provider client any more.

| Purpose | Caller | Model | Notes |
|---|---|---|---|
| `turn` | `createModelResponseWithRetry` (`agent/model.ts`), from the step loop | run route model | Retries, cut-off and recovery stay in the executor. Billed; a billing failure is shown to the user. |
| `title` | `maybeAutoGenerateTaskTitle` (`agent/model.ts`) | route quick model | Best effort; the title is written through `RunControl.setGeneratedTitle`. |
| `compaction` | `requestNativeCompaction` (`context-compaction/native.ts`) | run route model | Only for providers that support native compaction. |
| `compaction` | summary compaction (`context-compaction/summary.ts`), through `openai-tool-output`'s `ResponseRequester` | run route model | Also used by context-management checkpoints and swarm fork compaction. |
| `web_search` | `runClaudeWebSearch` (`agent/claude-web-search.ts`) | run route model | The hosted search tool is added from run policy. |

Not on the run path, and staying on the server: model routing (`model-routing/router-resolution.ts`, resolved during bootstrap), memory indexing embeddings, and usage activation checks.

The gateway always sets the model from the run's route and purpose, whatever the request body says, and settles usage for every purpose. Quota is read through `ModelGateway.isQuotaExceeded`.

## 13. Tool ownership

"Call the existing handler on the server and return its output" isn't enough: some handlers change run state that isn't in their output. For example, `handleConversationOrganization` stages outline and graph changes in `ToolDispatchState` and returns `{ staged: true }`; finalize persists them later. Other machinery advances branch leaves and command steps.

Every tool handler in `agent-tool-dispatch/handlers` gets one of three classes, recorded in a table that is a deliverable of phase 2:

- **Executor-state tools** run in the executor and change only run state, which the executor persists through the Run API (checkpoints, finalize). Examples: conversation organization, `wait`, context management, final response. They aren't platform tools.
- **Server tools** run on the server, keep their side effects on the server, and return output only. Examples: `memory_search`, web search, connector reads and sends, scheduling, subtask creation.
- **Mixed tools** change both. They return `{ output, stateDelta }` with a typed delta that the executor applies to its run state. Each mixed tool is listed with its delta type. A tool that can't be expressed this way stays cloud-only.

Persistence ownership is fixed: **the executor persists every conversation message, tool call and tool result** through the Run API. The platform tool host never appends messages or emits tool events for the call itself. It may emit domain events (for example, "task scheduled").

### 13.1 Tool classes

The milestone 0 phase 2 table. "Platform host" means the call goes through `RunControl.platform` (`PlatformToolHost`), which acts with the run's own identity: the executor can't name another task, project or workspace.

| Tools | Class | How it crosses the boundary |
|---|---|---|
| `final_response`, `update_conversation_outline`, `update_conversation_map`, `context_checkpoint_and_compact`, `context_checkpoint_and_trim`, `init_sandbox`, `list_skills`, `enable_skill`, `search_tools`, `exec` (code mode) | Executor-state | Run state only; persisted by finalize, checkpoints and the context store. Code mode dispatches nested calls through the same table. |
| Context management v2 tools (windows, notes, history) | Executor-state | `RunControl.context`, scoped to the run's task. |
| `run_shell`, `apply_patch`, `view_image`, `view_pdf_file`, skill tools, MCP tools | Machine | `MachineHost` and the storage roots. |
| `shell_session`, persistent `run_shell` | Server | `platform.persistentShell`; the session broker is on the server. |
| `query_tasks`, `view_task_history`, organized history, `memory_search` | Server (read-only) | Platform host. |
| `search_web` | Server (model call) | `ModelGateway` with purpose `web_search`. |
| `refresh_gh_token` | Server | `platform.refreshGitHubToken`; returns env for the machine. |
| Live sync tools, `search_live_sync_folder` | Server | Platform host. |
| `mark_artifact`, `create_project_canvas`, `show_canvas` | Server | Platform host for the records; files are written by the executor. |
| Computer Use tools | Server (milestone 3 moves them to host tools) | `platform.getDesktopComputerPresence` and `requestDesktopComputerAction`. |
| `schedule_task`, `edit_current_task_schedule`, `create_subtask`, `start_subtask` | Server (side-effecting) | Platform host. |
| `stop_task` | Mixed | `platform.pauseRecurringSchedule` pauses the schedule; the delta is the run's stop request (`stopRequest`). |
| `wait` | Mixed | `platform.applyInfiniteWait` moves a timed run's next run; the delta is the run's wait request (`waitRequest`). Shell-session conditions are read through `platform.readShellSessionWaitState`. |
| Long Horizon workflow tools | Cloud-only | Server-side hooks (`workflowActions`); excluded for device targets (section 14.3). |
| Subagent tools, Project Master tools, Agent Swarm tools | Cloud-only | Database-backed on the server; excluded for device targets. |

Every tool call, whatever its class, is recorded as started before it runs and cleared when its outcome is known (`RunControl.recordToolCallStart` / `recordToolCallResult`, table `task_run_tool_calls`). The next run of the task reports unfinished calls as "outcome unknown" instead of replaying them (section 10.1).

## 14. Bootstrap and device state

### 14.1 Bootstrap

`claim` returns what `prepareAgentRunContext` and `initializeAgentExecution` load from the database: task snapshot, conversation history and leaf, resolved model route and capabilities, tool options and enabled tool groups with their classes, skill catalog entries, the project payload (Project Context notes), the file host, the relative roots from section 6.4, inputs with sizes and hashes, and any unfinished tool calls (section 10.1). File contents (Project Context, `MEMORY.md`) are read by the executor from its root. Device facts that go into the prompt (OS, shell, root paths) are recorded with the task on first claim.

### 14.2 Versions

`claim` carries the executor's protocol version. The server refuses versions below its minimum, and the run stays pending with "Update the desktop app" (section 9). The desktop app auto-updates.

### 14.3 Server enforcement of v1 exclusions

Hiding things in the composer isn't enough: presets, schedules, follow-ups and direct API calls can request them. For device targets, the server rejects Agent Swarm, subagents and Project Master, and thread tasks in host mode, at task creation, follow-up, schedule creation and preset resolution; admission refuses them, and `availability.ts` drops their tools.

### 14.4 Tombstones

`device_file_tombstones(id, device_id, workspace_id, kind, target_id, relative_path, created_at, acked_at)`. When a task is archived or deleted, or a project or workspace deleted, the server writes tombstones for each device that may hold its state (local scratch, or the device-hosted files). The device fetches unacked tombstones at start and on reconnect, deletes the named paths (no walks beyond the named folder), and acks. Tombstones are deleted 30 days after ack.

## 15. Browser Use and Computer Use

These are the host tools from section 8.2. Both are device-wide resources shared by every local task, and Computer Use also by cloud tasks through the desktop bridge. Browser Use inside the sandbox (headless Chromium, as in the cloud) is per run and needs none of this.

**Computer Use.**
- The overlay and request deduplication wrapper around `performComputerAction` in `apps/desktop/src/main/index.ts` moves into `src/main/computer-use/service.ts`. The IPC handler and the local executor both call the service; nothing calls `performComputerAction` directly.
- **Arbitration.** One device-wide lock, owned by a task id. A cloud bridge request and a local tool call both acquire it. While a task holds it, actions from another task fail with "Computer Use is in use by <task>". It's released when the holding run ends, after 90 seconds without actions (the existing popup idle time), or when the run is fenced.
- Behavior is unchanged: foreground control of the real cursor and keyboard on macOS and Windows. `computer_local_shell` is replaced by `host_shell` for local tasks.

**Your Chrome.**
- The desktop app owns **one** host browser: the user's installed Chrome (`channel: "chrome"`, Edge as fallback) on a dedicated persistent Meowbert profile under `userData`. Tasks don't each launch it, since a persistent profile can only be open once.
- **Ownership.** One task at a time holds the browser, under a device-wide lock like Computer Use. Its Playwright MCP session connects to the app's browser. Another task's Browser Use calls fail with "the browser is in use by <task>" until it's released (run end, 5 minutes idle, or fencing).
- Headed, so the user can watch and take over. Logins made in the profile persist across tasks.

## 16. Live Drive folders (milestone 5)

In the cloud, a live Google Drive folder is an `rclone mount` the API runs with Linux FUSE at `<project root>/<link path>` (`google-drive-mount-manager.ts`). That mount exists only in the server's view, so a device can't use it. The device mounts the folder itself:

- **`rclone nfsmount` on macOS.** The desktop app bundles rclone and runs `rclone nfsmount` (the macOS built-in NFS client; no macFUSE) with the server's flags minus `--allow-other`. Config text and flags move into shared so both sides build the same mount. Mounts live under `<userData>/live-folders/<linkId>`, are reference-counted per link, unmounted when the last run releases them, cleaned up at app start, and killed when a run is fenced. In host mode the agent sees that path where a cloud task sees `<project root>/<link path>`. In sandbox mode the mount is bind-mounted into the container at `<project root>/<link path>`, as the server does; whether Docker Desktop can bind-mount an NFS-mounted path is part of the milestone 5 spike, and if it can't, live folders are host-mode only.
- **Credentials.** The device gets the same config the API writes: the provider client id and secret, the connection's token (refresh token included), and the link's `root_folder_id`. `root_folder_id` only sets rclone's starting folder; the token has full Drive scope.
- **Who can get it.** Only the user who connected the link (`updatedByUserId`), which is always true in a device-hosted workspace. Other members' devices can't mount it.
- **Consent.** The first time a device mounts a link, the app asks: "This computer will store a credential with access to your entire Google Drive (<account>). It keeps working until you disconnect Google Drive in Meowbert or remove Meowbert's access in your Google account. Removing this device or ending the task doesn't revoke it." Consent is per device and per connection.
- **Revocation.** Disconnecting the Drive connection in Meowbert must revoke the refresh token at Google's revocation endpoint, which invalidates every copy. The current disconnect doesn't do this; adding it is part of this milestone. Revoking a device deletes its configs but can't guarantee a copied token is gone, and the device settings say so.
- **Windows** isn't covered: `nfsmount` needs an NFS client only some editions ship. WinFsp with `rclone mount` is the likely later route.
- **Licensing.** rclone is MIT-licensed; record it in `THIRD_PARTY_NOTICES.md`.

Synced linked sources need no work in server-hosted workspaces: they're plain files in the project folder.

## 17. Invariants

1. An executor holds no database, Redis, Meilisearch or model provider credentials. The one credential a device may hold is the rclone config for live Drive folders its user connected and consented to (section 16).
2. A lease token only grants access to its own run, for its own user and device, at its own epoch.
3. Model usage is reserved before and settled after each call, on the server, from provider-reported usage. Overspend is bounded by input-token counting error.
4. Run completion and pending delivery commit in one transaction (AGENTS.md recovery contract).
5. Every mutating Run API call is idempotent under its operation id.
6. A device fences itself (no new actions, owned processes killed) before the server can reclaim its run.
7. A tool call whose outcome is unknown is never replayed automatically.
8. A local run never moves to another device or the cloud, except when an owner relinks a device-hosted workspace, after the old device's leases are revoked and the reclaim delay has passed.
9. A device run that isn't ready (offline, unverified storage, old version, no capacity, inputs not visible) waits in `pending` and doesn't count against workspace or project limits.
10. A task's execution target can always reach its workspace's files.
11. File access goes through a filesystem the executor can see. No upload, download, mirror or sync path exists.
12. Server code never resolves a device-hosted workspace's files; which features a workspace has is decided only by `workspaceFileFeatures`.
13. Local runs use the sandbox unless the task chose host mode. Host mode and `host_shell` have the user's full authority, with explicit consent; nothing claims otherwise.
14. The prompt prefix is stable across runs of a task, except once when the user moves the workspace root.
15. No automatic job, request path or run start walks a workspace, project or task tree (filesystem cost contract). Listings by the executor are limited to `context/` and memory. File browsing the user asks for and searches the agent runs are allowed, as in the cloud.
16. A device runs the same sandbox image as the cloud, pinned by the digest of its multi-architecture manifest, so each architecture gets its own build of the same release.

## 18. Security summary

- **Run API**: lease tokens bound to run, user, device and epoch; operation-id dedup; device revoke invalidates leases.
- **Admission**: a device run only goes to its own user's device, under device readiness and capacity.
- **Model proxy**: request allowlist, server-set model and limits, reservations, per-run and per-user concurrency.
- **Platform tools**: run with the run's own permissions and tool set, classified per section 13.
- **Storage**: whoever can mount a backend can read all of it. Local fits single-user or single-team installs; multi-tenant installs give each tenant its own backend (`storage_backend_id` per workspace). Stated in the Self-Hosting docs.
- **Device**: sandbox mode isolates like the cloud; host mode and `host_shell` have full user authority with consent (section 8).
- **Live Drive**: persistent account credential with explicit consent and provider-level revocation (section 16).
- **Turning it on**: off globally by default in `config/global.json`; workspace admins can turn it off per workspace.

## 19. Scope and accepted limitations

Out of scope for every milestone here: Agent Swarm, subagents and Project Master in local runs, and read-only thread tasks in host mode (enforced on the server, section 14.3); GitHub App workspace tokens on the device; sandbox-only skills; persistent shells that outlive the app; sharing or moving device-hosted workspaces.

Accepted limitations:

- Network mounts lag; artifacts can show as "syncing" for a while (section 6.6). Independent mounts of the same remote are unsupported (section 6.2).
- Mount permission mapping is the mount's job: the device user and the sandbox user must be able to write each other's files. rclone and SMB synthesize permissions; NFS needs a squash or uid mapping.
- Shared dependencies are installed per platform.
- Sandbox mode needs Docker Desktop and a large image download per device. Network storage is accepted only after its Docker bind-mount probe succeeds; host mode is a later milestone.
- Host mode only offers host-supported skills.
- One task at a time per device uses Browser Use, and one uses Computer Use.
- Device-hosted workspaces lack the features marked off in section 7.2.
- Live Drive folders: macOS only, only for the user who connected the link.

## 20. Skills on the device

In sandbox mode, skills come from the image, exactly as in the cloud.

In host mode, the desktop app uses the `skills/` tree bundled with its own build. Each `skill.json` gets a `host` field: `"supported"` (runs with only what the desktop app bundles) or absent. Today that's roughly the skills that are API or prompt only (google-drive, onedrive, outlook, pcloud, youtube, image-generation, deep-ai-search, guided-learning, writing-style-guide) and browser-use through the user's Chrome. The document skills (docx-studio, pptx-studio, openai-doc, typst, html-canvas) and the Python google-workspace server need the image.

---

# Part III: Implementation

## 21. Code changes by area

**New package `packages/run-executor`**: `RunControl`, `ModelGateway`, `MachineHost` and the pure run path (prompt assembly, step loop, tool dispatch, machine-tool and executor-state handlers, finalize). Keeps the OpenAI SDK, MCP SDK and QuickJS out of the API and web bundles.

**Shared (`packages/shared/src`)**: `task-execution-target.ts` (target plus machine mode, `sandbox` or `host`); `workspace-file-host.ts` (with `canTargetReachFileHost`); `workspace-file-features.ts`; `run-api.ts` (route schemas, bootstrap, lease payload, protocol version, operation ids, tool classes); `storage-marker.ts`; a root-relative path converter with containment checks; rclone Drive mount config and flags (milestone 5); the `host` field in the skill schema.

**Database (`db/migrations`)**, new numbered migrations per milestone:

- `devices` (user, name, platform, executor version, capabilities, consent, capacity, verified roots, last seen, revoked).
- `workspaces.file_host`, backfilled from `storage_backend_id`.
- `tasks.execution_target` (including the machine mode), `tasks.device_facts`.
- The cloud's current sandbox image reference and digest.
- `task_run_dispatches.lease_epoch`, `lease_device_id`, `lease_expires_at`, `pending_reason`.
- `run_api_operations`, `run_tool_calls` (start and result records for section 10.1), and a per-run `seq` on task events.
- `task_artifacts.publication_state`, size and hash; input size and hash on uploads.
- `device_file_tombstones`.
- Usage ledger reservations.

No new `TaskExecutionJob.mode`; the run-kind contract is untouched.

**API (`apps/api`)**: `routes/devices/`, `services/devices/`; `routes/runs/` and `services/runs/` with one module each for leases, operations, bootstrap, model proxy and reservations, platform tool host, artifact publication; task, follow-up, schedule and preset validation for device targets; workspace creation with file hosts, relink; the workflow inventory gates and root guards; storage markers; Google token revocation on Drive disconnect (milestone 5).

**Worker (`apps/worker`)**: recording the sandbox image reference and digest at startup; admission eligibility, device capacity and claim windows in `task-run-dispatch.ts`; device-run skips and lease reclaim in `task-run-recovery.ts`; the run path refactored onto the three interfaces; `SandboxMachineHost`; unknown-outcome handling in recovery; artifact publication loop; memory sync retries; `workspaceFileFeatures` checks in file-touching loops.

**Desktop (`apps/desktop`)**: `src/main/executor/` (`HttpRunControl`, `ProxyModelGateway`, `SandboxMachineHost` against Docker Desktop, `HostMachineHost`, fencing, pid files, container cleanup); `src/main/sandbox-image/` (Docker detection, the first-use prompt, pulls by digest with progress, updates, old-image removal); `src/main/storage/` (roots, markers, probes, path containment); `src/main/consent/`; `src/main/computer-use/service.ts` and the device lock; `src/main/browser-use/` and its lock; `src/main/workspace-files/` (IPC file operations, tombstones); `src/main/live-folders/` (milestone 5); device registration and the run stream; bundled `skills/`.

**Web (`apps/web`)**: the `WorkspaceFiles` adapter; feature visibility from `workspaceFileFeatures`; the Cloud / Local control and, under Local, Sandbox / Host (compact, no description copy above the composer per AGENTS.md); pending reasons and "syncing" artifacts; desktop settings for storage, devices, consent, capacity, browser profile and live-folder consents; "On this device" workspace creation and relink.

**Other**: `linux/arm64` in `.github/workflows/publish-sandbox-runtime.yml`.

**Docs**: user docs for local tasks, sandbox and host mode, the sandbox download, storage mount paths, what Local can do, device-hosted workspaces; Self-Hosting docs for the toggles, supported storage arrangements, per-tenant backends, and that model calls use server keys.

## 22. Milestones

Each milestone ships on its own and leaves cloud tasks working as before.

**Milestone 0: the boundary, cloud only.**

1. Fix the desktop build: add the `@meowbert/shared/*` `paths` mapping to `apps/desktop/tsconfig.json` (lint currently fails with 18 errors) and add `lint:desktop` to the root `lint` script.
2. Introduce `RunControl`, `ModelGateway` and `MachineHost`; move every database, Redis and model call on the run path behind them. Produce the tool-class table (section 13) and the model-call inventory (section 12). Add tool-call start/result records and unknown-outcome recovery. Pure refactor otherwise. This is the largest and riskiest phase; it needs regression coverage on completion, recovery and prompt prefix stability first.
3. Extract `packages/run-executor`.
4. Build the Run API with operation ids, epochs and sequencing, and the model proxy with allowlist and reservations. Run a cloud worker through `HttpRunControl` and `ProxyModelGateway` behind a config flag, against the acceptance tests in section 23.

**Milestone 1: one narrow local slice, in the sandbox.** macOS on Apple Silicon, Docker Desktop, server-hosted workspace, same-machine storage (section 6.2, arrangement 1). The `linux/arm64` image, the first-use download prompt and updates by digest. Standard agent in sandbox mode with all skills; cancellation; follow-ups; artifacts; recovery. Devices, admission eligibility and capacity, leases and container fencing, the Cloud / Local control, pending reasons. Passes every test in section 23 that applies.

**Milestone 2: network storage and Windows.** Shares from the server host (arrangement 2) with the Docker Desktop bind-mount spike, probes, input hashes, artifact publication states, memory sync retries. Windows with Docker Desktop.

**Milestone 3: host tools and host mode.** Computer Use service and lock, your-Chrome browser and lock, `host_shell`, host mode with consent, process-group fencing, `host` skills.

**Milestone 4: device-hosted workspaces.** `workspaces.file_host` and `workspaceFileFeatures` (can land earlier with no behavior change), the workflow inventory and gates, the desktop `WorkspaceFiles` implementation, tombstones, relink.

**Milestone 5: live Drive folders.** Bundled `rclone nfsmount`, credential endpoint, consent, Google revocation on disconnect.

Milestone 0 is worth doing even if Local never ships.

## 23. Acceptance tests

Failure-injection tests, run against the HTTP implementations from milestone 0 and the desktop executor from milestone 1:

1. **Lost response.** Drop the response to a committed `/messages`, `/events`, `/artifacts` and a scheduling tool call. The retry produces no duplicate message, event, artifact or schedule.
2. **Stale leaf.** Append with an outdated `expectedLeafId`; get 409 and recover without forking the branch.
3. **Lease expiry during a command.** Block heartbeats while a long shell command runs, in sandbox mode and in host mode. The device fences (stops the container, or kills the process group) before the server reclaims, and the recovered run gets an "outcome unknown" result for that call instead of rerunning it.
4. **App crash.** Kill the desktop app mid-command. On restart, its leftover containers are stopped and process groups killed before it claims again.
5. **Duplicate claims.** Two app instances with the same device id claim one run; exactly one wins.
6. **Offline at admission.** With project concurrency 1, a local task for an offline device doesn't block a cloud task in the same project.
7. **Device capacity.** Three local runs for a device with capacity 2: the third stays pending until one finishes.
8. **Delayed output visibility** (milestone 2). An artifact written through a lagging mount is `pending`, then `available` when the server can see it, and later tasks aren't pointed at it before then.
9. **Inputs not visible** (milestone 2). A claim whose inputs aren't visible returns the run to pending, not failed.
10. **Disconnect mid-stream.** Drop the device during a model stream; usage is settled once, from provider usage.
11. **Budget race.** Concurrent model requests from a modified client against a small remaining allowance; total spend stays within the bound in section 12.
12. **Disallowed request fields.** A model request with a different model, hosted tools or unknown fields is rejected.
13. **Excluded features.** Creating, following up or scheduling a device-target task with Swarm, subagents, Project Master or thread mode is rejected by the API.
14. **Sandbox not ready.** With Docker stopped, or the image missing, or a newer digest on the server, a local run stays pending with the right reason, and runs once the download finishes. Declining the download offers host mode and starts nothing.
15. **Device-hosted workflows** (milestone 4). Creating tasks, uploading, browsing and archiving in a device-hosted workspace never hits a root guard.

## 24. Decisions and open questions

Decided:

1. The executor lives in `packages/run-executor`.
2. Local runs use the cloud's sandbox image in the device's Docker by default. Host mode is an option with full authority and explicit consent; path checks there are guard rails, not a boundary; read-only thread tasks need the sandbox (section 8). This replaces the earlier per-path approval model.
3. Local is not offered from the web app.
4. A device run waits at most 24 hours for its device by default.
5. Files go through a filesystem the executor can see, not through the API.
6. Workspaces have a fixed file host, server or device. Device-hosted workspaces are single-user and never move to a server.
7. Live Drive folders use bundled `rclone nfsmount` with the server's config, only for the user who connected the link, with explicit consent and revocation at Google (section 16).
8. The first local release is the narrow slice of milestone 1.
9. The sandbox is downloaded on first use after a prompt, pulled by the digest the cloud runs, and kept updated in the background (section 8.3).
10. Mounting the workspace storage on a device is manual: the user or operator mounts it and enters the path. The app only verifies it (section 6.3). Live Drive folders are the exception; the app mounts those itself (section 16).
11. `memory_search` for device-hosted workspaces stays off for now; building the index on the device can come later.
12. One global toggle covers both local tasks and device-hosted workspaces.
13. Default device capacity is 2 concurrent local runs.
14. Cloud sandboxes stay `linux/amd64`. The `linux/arm64` build is published for devices only.

15. The Run API is served by the worker that claims the run, and the API forwards to it. The claim records that worker's listener URL (`task_run_dispatches.lease_api_url`) with the lease, so any number of workers can serve runs. If that worker goes away, the run's lease lapses and the run is claimed again.
16. Agent Swarm, subagents, Project Master and Long Horizon workflows stay database-backed on the server. The executor reaches them through the `RunFeatures` hooks (`packages/run-executor/src/agent/ports/run-features.ts`); executors outside the control plane get `noRunFeatures`, and the server refuses those features for device runs (section 14.3). A cloud worker running through the Run API still runs these hooks in process.
17. Operation dedup records the operation before running it and stores the response after, rather than committing both in one transaction: that would mean threading one database client through every write on the run path. A write that crashes in between is reported as "outcome unknown" on retry and is never applied twice.
18. Events are deduplicated by operation id and by a per-session sequence number that drops late duplicates; `task_events` gets no `seq` column.
19. An append must extend the run's branch: its parent is the run's last message or a descendant of it. Descendants are allowed because the server's own hooks (subagent mail, swarm notes, Project Master reports) append between the executor's messages.
20. The executor package keeps the worker's directory layout without `services/`, and the worker imports its modules by path (`@meowbert/run-executor/agent/loop`). Worker tests resolve those paths to the package source so mocks apply inside it.
21. Executor settings that came from the worker's config (step limit, command timeout and output limit, shell, skills) arrive as `ExecutorSettings` in the run environment.

22. Milestone 1 was limited to Apple Silicon macOS, Docker Desktop, a loopback server URL, and server-hosted same-machine storage. Milestone 2 adds Windows x64/arm64 and remote server-hosted SMB/NFS roots that pass the Docker storage probe. Host mode, host tools, threads, schedules, subagents, Agent Swarm, Project Master, and Long Horizon remain unavailable locally. Declining a download starts nothing; offering host mode waits for milestone 3.
23. Docker storage probes use a separate short-lived container with the backend root mounted, before advertising readiness and before each run. The agent container receives only the existing scoped task mounts, so it cannot browse the entire backend. Marker verification includes both backend ID and random install ID, followed by an exclusive write/delete probe.
24. Skill assets are extracted from the exact sandbox image into the desktop's owned resources directory and mounted read-only at that device path. This preserves built Linux dependencies and avoids relying on the repository checkout or packaging unbuilt skill sources.
25. Local persistent shells use the existing Python protocol inside the current run container, with run-owned session IDs, bounded lifetimes, safe task-relative output files, and local wait-state reads. They end with the run container; they do not attach to server-owned project terminal sessions.
26. Device admission and claims require the exact Run API protocol version. Pending local runs expire after 24 hours; lease reclaim resets their eligibility timestamp. Default device capacity is 2 and is configurable in desktop preferences. Local containers cap server limits at 2 CPUs, 2048 MB RAM, 256 PIDs, and 4096 MB writable storage.
27. Download consent and storage roots are scoped to the active server profile. The first-use prompt reads the arm64 compressed layer sizes from registry manifests when available, and reports an unknown size when registry metadata is unavailable. Images with no pullable digest require a preloaded arm64 build. Only images downloaded by this desktop are eligible for old-image cleanup.
28. Electron's Node runtime successfully loaded QuickJS, executed an async code-mode tool call, and constructed/closed an MCP client. Docker MCP stdio, the complete local task GUI flow, and an actual arm64 image build remain live acceptance checks.


29. Run API protocol 2 adds a scoped, deduplicated storage-wait release. It frees device/project admission without ending the run, preserves cancellation and the original pending timeout, fences further work from that lease, and backs off claims for 30 seconds.
30. Upload integrity is recorded in existing task_artifacts rows with kind=input. Device artifacts include SHA-256 and use durable pending/available/missing publication. Existing cloud artifacts stay available; only available artifacts are listed to later tasks. A completed hash mismatch is terminal; missing or size-mismatched files retry by name for up to 30 minutes.
31. Memory refresh requests at completion, +1 minute and +5 minutes commit with completion/delivery and survive worker restarts. Failed indexing status retains the request for retry. memory_search already syncs before searching.
32. Windows uses the local Docker Desktop Linux-engine named pipe, native image architecture, and /meowbert-host/drives/<drive> or /meowbert-host/unc/<server>/<share> inside the container. Filesystem tools translate those paths back to native paths before existing containment checks. Cloud and macOS paths retain their existing mapping.
33. Windows reads only image-owned skill manifests/docs into its desktop catalog; Linux binaries, dependencies and symlinks remain at /app/skills in the immutable image. Desktop PDF preparation uses the image's bundled Python in mounted scratch, including force-included attachments; no host Python installation is required.
34. The Docker Desktop network-share spike is an opt-in integration test using TEST_LOCAL_STORAGE_ROOT, TEST_LOCAL_STORAGE_BACKEND_ID, TEST_LOCAL_STORAGE_INSTALL_ID and TEST_LOCAL_SANDBOX_IMAGE. Code and automated tests do not claim live macOS/Windows share acceptance when no daemon/test hosts are available.

35. Host commands wait behind a pipe gate until their detached group is durably recorded. EOF never starts a command. Fencing terminates then force-kills groups; startup cleans leftover records before readiness. Host MCP servers use Electron's bundled Node, and host-supported skills are bundled at desktop build time without runtime installs.
36. Computer Use has one task owner across cloud bridge and local calls, with deduplication and queued-action invalidation on release. Your Chrome has one headed persistent profile and an independent task lock. Fencing awaits browser closure, including an in-progress launch.
37. Migration 146 backfills server file hosts, fixes their host kind, clears device absolute roots, enforces device task targets, and records deletion/archive tombstones. Workspace deletion preserves the chosen folder. Relink revokes epochs immediately, then reassigns unfinished uncancelled dispatches after 90 seconds and clears their old leases for recovery.
38. Recurring runs and scheduling tools preserve persisted device targets and use device admission. Subagents and workflows stay excluded. Host threads are refused; sandbox threads remain unavailable in this release.
39. Device inline-file tickets are random, task/server-bound and expire after one minute. A task-local location journal travels with the folder; relocation notes use appendPromptEnvelopeDelta and remain stable until the next move.

Open:

1. Matching a model request's function tools to the run's resolved tool set (section 12.0).
2. A per-user limit on concurrent model requests across runs.
3. Complete the Docker Desktop failure-injection and packaged-app acceptance checks on a machine with a running daemon; build and publish the multi-architecture sandbox before using downloaded local runs.

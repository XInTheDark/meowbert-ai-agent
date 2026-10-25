import { configureLocalRunPlatform } from "./local-run-platform";
import { localRunEnvironment } from "./local-run-environment";
import { randomUUID } from "node:crypto";
import { prepareRunLiveFolders } from "../live-folders/run-folders";
import fs from "node:fs/promises";
import { localRunRelocationNote } from "./local-run-paths";
import { verifyDeviceWorkspace, resolveDevicePath } from "../workspace-files/roots";
import { HostProcesses } from "./host-processes";
import { computerUseService } from "../computer-use/service";
import { getHostBrowser } from "../browser-use/runtime";
import type { ExecutorSettings } from "@meowbert/run-executor/agent/ports/executor-settings";
import { runAgentJob } from "@meowbert/run-executor/agent/index";
import { createRunApiClient } from "@meowbert/run-executor/run-api/client";
import { createHttpRunControl } from "@meowbert/run-executor/run-api/http-run-control";
import type { MachineHost } from "@meowbert/run-executor/agent/ports/machine-host";
import type { TaskExecutionJob } from "@meowbert/shared";
import { resolveVerifiedStoragePath, verifyMountedStorage } from "../storage/roots";
import { probeDesktopSandboxStorage } from "./sandbox-machine-host";
import type { DesktopLocalExecutorOptions } from "./local-executor";
import type { DeviceApi } from "./device-api";
import path from "node:path";
import { waitForRunInputs, StorageNotReadyError } from "../storage/inputs";

export interface DeviceRunNotice { admitted_at?: string | null; run_id: string; queue_state: string; payload_json: TaskExecutionJob }
export function startLocalRun(options: DesktopLocalExecutorOptions, api: DeviceApi, notice: DeviceRunNotice, image: string, skillsRootDir: string, settings: ExecutorSettings, installId: string) {
  const workspaceRoot = options.workspaceRoots?.[notice.payload_json.workspaceId];
  if (workspaceRoot) options = { ...options, storageRoot: workspaceRoot, storageBackendId: "workspace:" + notice.payload_json.workspaceId };
  const abort = new AbortController();
  const folderConsumer = notice.run_id + ":" + randomUUID();
  const runIdentity = { taskId: notice.payload_json.taskId, runId: notice.run_id };
  const host = notice.payload_json.executionTarget?.kind === "local" && notice.payload_json.executionTarget.mode === "host";
  const runsRoot = options.runsRoot ?? path.join(options.scratchRoot, "../runs");
  const hostProcesses = new HostProcesses(path.join(runsRoot, notice.run_id + "-tools.pids"));
  let machine: MachineHost | null = null;
  let control: ReturnType<typeof createHttpRunControl> | null = null;
  const fence = async () => {
    abort.abort();
    control?.stop();
    computerUseService.release(notice.payload_json.taskId);
    try { await Promise.all([machine?.stop(), hostProcesses.stop(), getHostBrowser(options.resourcesRoot).release(notice.payload_json.taskId)]); }
    finally { await options.liveFolders?.release(folderConsumer); }
  };
  const done = (async () => {
    try {
      const check = workspaceRoot ? await verifyDeviceWorkspace(workspaceRoot, notice.payload_json.workspaceId).then(() => ({ ok: true })) : await verifyMountedStorage({ mountPath: options.storageRoot, backendId: options.storageBackendId, deviceId: options.deviceId, installId });
      if (!check.ok) throw new StorageNotReadyError("The workspace storage is unavailable.");
    } catch (error) {
      abort.signal.throwIfAborted();
      await api.request("/api/devices/" + options.deviceId + "/runs/" + notice.run_id + "/refuse-storage", "POST", {});
      options.onPendingReason?.("Waiting for storage: the selected storage folder is unavailable.", runIdentity);
      return;
    }
    abort.signal.throwIfAborted();
    const claim = await api.request<{ token: string }>("/api/devices/" + options.deviceId + "/runs/" + notice.run_id + "/claim", "POST", {});
    const client = createRunApiClient({ baseUrl: options.apiBaseUrl + "/api", runId: notice.run_id, token: claim.token, fetch: options.fetch, signal: abort.signal, requestTimeoutMs: 15_000 });
    const remote = createHttpRunControl(client, { onFenced: () => { void fence(); } });
    control = remote;
    const platform = { ...remote.platform };
    let executing = false;
    let storageStage = "workspace folder";
    try {
      if (host && !options.hostConsent) throw new Error("Host mode requires consent on this device.");
      const bootstrap = await remote.bootstrap();
      if (bootstrap.roots.storageBackendId !== options.storageBackendId) throw new Error("The run belongs to another storage backend.");
      if (bootstrap.fileHost?.kind === "device") {
        if (bootstrap.fileHost.deviceId !== options.deviceId) throw new Error("The workspace belongs to another device.");
        const root = await verifyDeviceWorkspace(options.storageRoot, bootstrap.snapshot.task.workspace_id);
        const projectRoot = await resolveDevicePath(root, bootstrap.roots.envRootRelative!);
        await fs.mkdir(path.join(projectRoot, "context"), { recursive: true });
      }
      const workspaceRoot = await resolveVerifiedStoragePath(options.storageRoot, bootstrap.roots.workspaceRootRelative);
      storageStage = "project folder";
      const envRoot = await resolveVerifiedStoragePath(options.storageRoot, bootstrap.roots.envRootRelative, { createDirectory: true });
      try {
        if (!host) await probeDesktopSandboxStorage({ image, scratchRoot: options.scratchRoot, skillsRootDir, storageRoot: options.storageRoot,
          backendId: options.storageBackendId, deviceId: options.deviceId, installId });
      } catch { throw new StorageNotReadyError("Waiting for storage: Docker Desktop cannot access the selected mount."); }
      storageStage = "run inputs";
      await waitForRunInputs({ taskDir: path.resolve(envRoot, bootstrap.snapshot.task.task_root_path), inputs: bootstrap.inputs, signal: abort.signal });
      storageStage = "live Drive folders";
      const liveSyncFiles = await prepareRunLiveFolders({ options, bootstrap, runId: notice.run_id, token: claim.token, consumer: folderConsumer, host, signal: abort.signal });
      storageStage = "task folder";
      const workspaceRelocationNote = await localRunRelocationNote(path.resolve(envRoot, bootstrap.snapshot.task.task_root_path), { workspaceRoot, envRoot });
      configureLocalRunPlatform({ platform, options, taskId: notice.payload_json.taskId, signal: abort.signal,
        hostProcesses, envRoot, bootstrap, settings, liveSyncFiles });
      executing = true;
      await runAgentJob(notice.payload_json, localRunEnvironment({ options, taskId: notice.payload_json.taskId, host,
        image, skillsRootDir, settings, installId, signal: abort.signal, platform, client, remote, workspaceRelocationNote,
        bootstrap: { ...bootstrap, liveSyncFiles, roots: { ...bootstrap.roots, workspaceRoot, envRoot } },
        onMachine: (value) => { machine = value; } }));
    } catch (error) {
      const storageUnavailable = !executing && ["ENOENT", "EIO", "ESTALE", "ENOTCONN", "ETIMEDOUT", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "");
      if (!(error instanceof StorageNotReadyError) && !storageUnavailable) throw error;
      const failure = error as NodeJS.ErrnoException;
      const message = error instanceof StorageNotReadyError ? error.message
        : "Waiting for storage: " + storageStage + " is unavailable (" + failure.code + ")" + (failure.path ? ": " + failure.path : ".");
      await remote.emitEvent("log", { stage: "startup.storage", phase: "waiting", message }).catch(() => undefined);
      await client.call("control.releaseForStorage", []);
      options.onPendingReason?.(message, runIdentity);
    } finally { remote.stop(); await fence(); }
  })();
  return { done, fence, image, workspaceId: notice.payload_json.workspaceId };
}

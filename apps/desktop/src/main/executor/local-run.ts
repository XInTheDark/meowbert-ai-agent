import fs from "node:fs/promises";
import { localRunRelocationNote } from "./local-run-paths";
import { verifyDeviceWorkspace, resolveDevicePath } from "../workspace-files/roots";
import { createHostMachineProvider, executeHostCommand } from "./host-machine-host";
import { HostProcesses } from "./host-processes";
import { computerUseService } from "../computer-use/service";
import { getComputerUseStatus } from "../computer";
import { startMcpServer } from "@meowbert/run-executor/agent/mcp-client";
import { getHostBrowser } from "../browser-use/runtime";
import os from "node:os";
import type { ExecutorSettings } from "@meowbert/run-executor/agent/ports/executor-settings";
import { runAgentJob } from "@meowbert/run-executor/agent/index";
import { noRunFeatures } from "@meowbert/run-executor/agent/ports/run-features";
import { createRunApiClient } from "@meowbert/run-executor/run-api/client";
import { createHttpRunControl } from "@meowbert/run-executor/run-api/http-run-control";
import { createProxyModelGateway } from "@meowbert/run-executor/run-api/proxy-model-gateway";
import type { MachineHost } from "@meowbert/run-executor/agent/ports/machine-host";
import type { TaskExecutionJob } from "@meowbert/shared";
import { resolveVerifiedStoragePath, verifyMountedStorage } from "../storage/roots";
import { createDesktopSandboxMachineProvider, probeDesktopSandboxStorage } from "./sandbox-machine-host";
import type { DesktopLocalExecutorOptions } from "./local-executor";
import { createHostPersistentShells } from "./host-persistent-shells";
import { createLocalPersistentShells } from "./persistent-shells";
import type { DeviceApi } from "./device-api";
import path from "node:path";
import { waitForRunInputs, StorageNotReadyError } from "../storage/inputs";
import { sharedSandboxDependencies } from "../sandbox-image/platform";

export interface DeviceRunNotice { run_id: string; queue_state: string; payload_json: TaskExecutionJob }
export function startLocalRun(options: DesktopLocalExecutorOptions, api: DeviceApi, notice: DeviceRunNotice, image: string, skillsRootDir: string, settings: ExecutorSettings, installId: string) {
  const workspaceRoot = options.workspaceRoots?.[notice.payload_json.workspaceId];
  if (workspaceRoot) options = { ...options, storageRoot: workspaceRoot, storageBackendId: "workspace:" + notice.payload_json.workspaceId };
  const abort = new AbortController();
  const host = notice.payload_json.executionTarget?.kind === "local" && notice.payload_json.executionTarget.mode === "host";
  const runsRoot = options.runsRoot ?? path.join(options.scratchRoot, "../runs");
  const hostProcesses = new HostProcesses(path.join(runsRoot, notice.run_id + "-tools.pids"));
  let machine: MachineHost | null = null;
  let control: ReturnType<typeof createHttpRunControl> | null = null;
  const fence = async () => {
    abort.abort();
    control?.stop();
    computerUseService.release(notice.payload_json.taskId);
    await Promise.all([machine?.stop(), hostProcesses.stop(), getHostBrowser(options.resourcesRoot).release(notice.payload_json.taskId)]);
  };
  const done = (async () => {
    const check = workspaceRoot ? await verifyDeviceWorkspace(workspaceRoot, notice.payload_json.workspaceId).then(() => ({ ok: true })) : await verifyMountedStorage({ mountPath: options.storageRoot, backendId: options.storageBackendId, deviceId: options.deviceId, installId });
    if (!check.ok || abort.signal.aborted) throw new Error("The workspace storage is unavailable.");
    const claim = await api.request<{ token: string }>("/api/devices/" + options.deviceId + "/runs/" + notice.run_id + "/claim", "POST", {});
    const client = createRunApiClient({ baseUrl: options.apiBaseUrl + "/api", runId: notice.run_id, token: claim.token, fetch: options.fetch, signal: abort.signal, requestTimeoutMs: 15_000 });
    const remote = createHttpRunControl(client, { onFenced: () => { void fence(); } });
    control = remote;
    if (host && !options.hostConsent) throw new Error("Host mode requires consent on this device.");
    const machines = host ? createHostMachineProvider({ scratchRoot: options.scratchRoot, runsRoot, consent: options.hostConsent === true }) : createDesktopSandboxMachineProvider({ image, scratchRoot: options.scratchRoot, skillsRootDir, storageRoot: options.storageRoot, backendId: options.storageBackendId, deviceId: options.deviceId, installId });
    const platform = { ...remote.platform };
    let executing = false;
    try {
      const bootstrap = await remote.bootstrap();
      if (bootstrap.roots.storageBackendId !== options.storageBackendId) throw new Error("The run belongs to another storage backend.");
      if (bootstrap.fileHost?.kind === "device") {
        if (bootstrap.fileHost.deviceId !== options.deviceId) throw new Error("The workspace belongs to another device.");
        const root = await verifyDeviceWorkspace(options.storageRoot, bootstrap.snapshot.task.workspace_id);
        const projectRoot = await resolveDevicePath(root, bootstrap.roots.envRootRelative!);
        await fs.mkdir(path.join(projectRoot, "context"), { recursive: true });
      }
      const workspaceRoot = await resolveVerifiedStoragePath(options.storageRoot, bootstrap.roots.workspaceRootRelative);
      const envRoot = await resolveVerifiedStoragePath(options.storageRoot, bootstrap.roots.envRootRelative);
      try {
        if (!host) await probeDesktopSandboxStorage({ image, scratchRoot: options.scratchRoot, skillsRootDir, storageRoot: options.storageRoot,
          backendId: options.storageBackendId, deviceId: options.deviceId, installId });
      } catch { throw new StorageNotReadyError("Waiting for storage: Docker Desktop cannot access the selected mount."); }
      await waitForRunInputs({ taskDir: path.resolve(envRoot, bootstrap.snapshot.task.task_root_path), inputs: bootstrap.inputs, signal: abort.signal });
      const workspaceRelocationNote = await localRunRelocationNote(path.resolve(envRoot, bootstrap.snapshot.task.task_root_path), { workspaceRoot, envRoot });
      platform.getDesktopComputerPresence = async () => options.computerUseEnabled
        ? ({ status: await getComputerUseStatus() }) as never : null;
      platform.requestDesktopComputerAction = async (input) => {
        abort.signal.throwIfAborted();
        if (!options.computerUseEnabled) throw new Error("Computer Use is disabled on this device.");
        return computerUseService.performAction({ ...input, taskId: notice.payload_json.taskId });
      };
      if (options.hostConsent && options.hostShellEnabled) {
        platform.hostShell = async ({ command, timeoutMs }) => {
          abort.signal.throwIfAborted();
          return { ...await executeHostCommand(hostProcesses, { command, timeoutMs,
            shell: process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/zsh",
            workingDir: path.resolve(envRoot, bootstrap.snapshot.task.task_root_path), maxOutputKb: settings.maxCommandOutputKb, abortSignal: abort.signal }) };
        };
      }
      executing = true;
      await runAgentJob(notice.payload_json, {
        control: { ...remote, platform, bootstrap: async () => ({ ...bootstrap, roots: { ...bootstrap.roots, workspaceRoot, envRoot } }) },
        models: createProxyModelGateway(client),
        machines: { ...machines, start: async (spec) => {
          if (abort.signal.aborted) throw new Error("The local executor has stopped.");
          machine = await machines.start(spec);
          if (abort.signal.aborted) { await machine.stop(); throw new Error("The local executor has stopped."); }
          Object.assign(platform, host ? createHostPersistentShells({ machine, spec, signal: abort.signal }) : createLocalPersistentShells({ machine, spec, signal: abort.signal }));
          return machine;
        } },
        features: noRunFeatures,
        connectSkill: (manifest, dir, sandbox, timeout, env) => {
          abort.signal.throwIfAborted();
          if (manifest.id === "host-browser") {
            if (!options.hostBrowserEnabled) throw new Error("Your Chrome is disabled on this device.");
            return getHostBrowser(options.resourcesRoot).connect(notice.payload_json.taskId, abort.signal);
          }
          return startMcpServer(manifest, dir, sandbox, timeout, env);
        },
        settings: { ...settings, hostMode: host, hostBrowserEnabled: options.hostBrowserEnabled, workspaceRelocationNote,
          shell: host ? (process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/zsh") : settings.shell,
          sharedDependenciesDirectory: host ? ".meowbert/shared-" + os.platform() + "-" + os.arch() : sharedSandboxDependencies(),
          sandboxPdfPreparation: !host,
          sandboxSkillsRootDir: !host && process.platform === "win32" ? "/app/skills" : undefined,
          skills: { ...settings.skills, rootDir: host ? options.hostSkillsRoot ?? skillsRootDir : skillsRootDir } }
      });
    } catch (error) {
      const storageUnavailable = !executing && ["ENOENT", "EIO", "ESTALE", "ENOTCONN", "ETIMEDOUT", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "");
      if (!(error instanceof StorageNotReadyError) && !storageUnavailable) throw error;
      await client.call("control.releaseForStorage", []);
      options.onPendingReason?.(error instanceof StorageNotReadyError ? error.message : "Waiting for storage: the workspace root is unavailable.");
    } finally { remote.stop(); await fence(); }
  })();
  return { done, fence, image, workspaceId: notice.payload_json.workspaceId };
}

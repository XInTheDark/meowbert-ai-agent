import { EventEmitter } from "node:events";
import { LiveFolderManager } from "../live-folders/manager";
import { cleanupLiveFolderMounts } from "../live-folders/native-mount";
import { confirmLiveFolderConsent } from "../live-folders/consent";
import path from "node:path";
import { app, dialog } from "electron";
import { readBootstrapData, saveLocalExecutionSettings, listLocalExecutionDeviceIds } from "../state";
import type { DesktopLocalExecutionStatus } from "../../shared";
import { stopDesktopContainers } from "../sandbox-image/resources";
import { cleanupHostProcesses } from "./host-processes";
import { readSandboxHistory } from "../sandbox-image/history";
import { sandboxDownloadSize } from "../sandbox-image/download-size";
import { startDesktopLocalExecutor } from "./local-executor";

let executor: Awaited<ReturnType<typeof startDesktopLocalExecutor>> | null = null;
let pending: Promise<unknown> = Promise.resolve();
let generation = 0;
let status: DesktopLocalExecutionStatus = { state: "disabled", message: null };
const statusEvents = new EventEmitter();
const runIssues = new Map<string, NonNullable<DesktopLocalExecutionStatus["runIssues"]>[number]>();
let runIssueServer: string | null = null;
function setStatus(next: DesktopLocalExecutionStatus): void {
  status = { ...next, runIssues: [...runIssues.values()] };
  statusEvents.emit("change", status);
}
export function onLocalExecutionStatusChanged(listener: (value: DesktopLocalExecutionStatus) => void): () => void {
  statusEvents.on("change", listener); return () => { statusEvents.off("change", listener); };
}
export async function checkLocalExecutionUpdates(): Promise<DesktopLocalExecutionStatus> {
  if (!executor) return startConfiguredLocalExecutor();
  await executor.checkForUpdates(); return status;
}
export function getLocalExecutionStatus(): DesktopLocalExecutionStatus { return status; }
export function stopLocalExecutor(): Promise<void> {
  generation += 1;
  const work = pending.then(async () => { const current = executor; executor = null; await current?.stop(); });
  pending = work.catch(() => undefined);
  return work;
}
export function startConfiguredLocalExecutor(): Promise<DesktopLocalExecutionStatus> {
  const currentGeneration = ++generation;
  setStatus({ ...status, state: "starting", hostReady: false, sandboxReady: false, message: "Starting local execution…" });
  const work = pending.then(async () => {
    const current = executor; executor = null; await current?.stop();
    if (generation !== currentGeneration) return status;
    await cleanupHostProcesses(path.join(app.getPath("userData"), "runs"));
    const liveFoldersRoot = path.join(app.getPath("userData"), "live-folders");
    await cleanupLiveFolderMounts(liveFoldersRoot);
    for (const deviceId of await listLocalExecutionDeviceIds()) await stopDesktopContainers(deviceId).catch(() => undefined);
    const bootstrap = await readBootstrapData();
    const settings = bootstrap.localExecutionSettings;
    if (runIssueServer !== settings.serverBaseUrl) { runIssues.clear(); runIssueServer = settings.serverBaseUrl; }
    if (!settings.enabled || (!settings.storageRoot && !Object.keys(settings.workspaceRoots ?? {}).length) || !settings.serverBaseUrl || !bootstrap.token) {
      setStatus({ ...status, sandbox: await readSandboxHistory(path.join(app.getPath("userData"), "sandbox-resources")), state: "disabled", hostReady: false, sandboxReady: false, message: null }); return status;
    }
    executor = await startDesktopLocalExecutor({
      apiBaseUrl: settings.serverBaseUrl, token: bootstrap.token, deviceId: settings.deviceId,
      executorVersion: app.getVersion(), maxConcurrentRuns: settings.maxConcurrentRuns, storageBackendId: settings.storageBackendId, storageRoot: settings.storageRoot ?? "", workspaceRoots: settings.workspaceRoots,
      liveDriveEnabled: settings.liveDriveEnabled,
      liveFolders: settings.liveDriveEnabled && process.platform === "darwin" ? new LiveFolderManager(liveFoldersRoot,
        path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "dist"), "live-folder-runtime", "rclone-" + process.arch)) : undefined,
      onLiveFolderConsent: (folder) => confirmLiveFolderConsent(settings.serverBaseUrl!, settings.deviceId, folder),
      hostConsent: settings.hostConsent, hostShellEnabled: settings.hostShellEnabled,
      computerUseEnabled: settings.computerUseEnabled, hostBrowserEnabled: settings.hostBrowserEnabled,
      runsRoot: path.join(app.getPath("userData"), "runs"),
      hostSkillsRoot: app.isPackaged ? path.join(process.resourcesPath, "host-skills") : path.join(app.getAppPath(), "dist/host-skills"),
      scratchRoot: path.join(app.getPath("userData"), "scratch"),
      resourcesRoot: path.join(app.getPath("userData"), "sandbox-resources"), downloadConsent: settings.downloadConsent,
      onSandboxDownloadRequired: async (image, unavailableReason) => {
        const bytes = unavailableReason ? null : await sandboxDownloadSize(image);
        if (generation !== currentGeneration) return false;
        const size = bytes === null ? "Download size is unavailable." : "Download: approximately " + (bytes / 1_000_000_000).toFixed(1) + " GB.";
        const result = await dialog.showMessageBox({ type: "question", buttons: unavailableReason ? ["Cancel", "Use Host Mode Instead"] : ["Download", "Use Host Mode Instead", "Cancel"], defaultId: 0, cancelId: unavailableReason ? 0 : 2,
          title: "Local execution", message: unavailableReason ?? "Download the Meowbert sandbox for local tasks?",
          detail: unavailableReason ? "Docker Desktop: https://www.docker.com/products/docker-desktop/" : image.reference + "\n" + size + " Future sandbox updates download automatically." });
        if (generation !== currentGeneration) return false;
        if (result.response === 1) {
          const latest = await readBootstrapData();
          const saved = await confirmHostExecutionSettings({ ...latest.localExecutionSettings, hostConsent: true, defaultMode: "host" });
          await saveLocalExecutionSettings(saved);
          void startConfiguredLocalExecutor();
          return false;
        }
        if (result.response !== 0 || unavailableReason) return false;
        const latest = await readBootstrapData();
        if (latest.localExecutionSettings.serverBaseUrl !== settings.serverBaseUrl) return false;
        await saveLocalExecutionSettings({ ...latest.localExecutionSettings, downloadConsent: true });
        return true;
      },
      onPendingReason: (message, run) => {
        if (generation !== currentGeneration) return;
        if (run) { runIssues.set(run.taskId, { ...run, message }); setStatus(status); }
        else setStatus({ ...status, state: "error", message });
      },
      onRunStarted: (taskId) => {
        if (generation === currentGeneration && runIssues.delete(taskId)) setStatus(status);
      },
      onStatus: (next) => { if (generation === currentGeneration) setStatus(next); }
    });
    return status;
  }).catch((error) => {
    if (generation === currentGeneration) setStatus({ ...status, state: "error", message: error instanceof Error ? error.message : String(error) });
    return status;
  });
  pending = work;
  return work;
}

export async function confirmHostExecutionSettings(settings: import("../../shared").DesktopLocalExecutionSettings) {
  const current = (await readBootstrapData()).localExecutionSettings;
  if (settings.hostConsent && !current.hostConsent) {
    const result = await dialog.showMessageBox({ type: "warning", buttons: ["Allow", "Cancel"], defaultId: 1, cancelId: 1,
      title: "Allow host execution", message: "Tasks in host mode can run any command as you on this computer and read or change any of your files.",
      detail: "Host shell has the same authority. You can revoke access in Local Execution settings." });
    if (result.response !== 0) return { ...settings, hostConsent: false, hostShellEnabled: false, defaultMode: "sandbox" as const };
  }
  return settings;
}

import path from "node:path";
import { app, dialog } from "electron";
import { readBootstrapData, saveLocalExecutionSettings, listLocalExecutionDeviceIds } from "../state";
import type { DesktopLocalExecutionStatus } from "../../shared";
import { stopDesktopContainers } from "../sandbox-image/resources";
import { sandboxDownloadSize } from "../sandbox-image/download-size";
import { startDesktopLocalExecutor } from "./local-executor";

let executor: Awaited<ReturnType<typeof startDesktopLocalExecutor>> | null = null;
let pending: Promise<unknown> = Promise.resolve();
let generation = 0;
let status: DesktopLocalExecutionStatus = { state: "disabled", message: null };
export function getLocalExecutionStatus(): DesktopLocalExecutionStatus { return status; }
export function stopLocalExecutor(): Promise<void> {
  generation += 1;
  const work = pending.then(async () => { const current = executor; executor = null; await current?.stop(); });
  pending = work.catch(() => undefined);
  return work;
}
export function startConfiguredLocalExecutor(): Promise<DesktopLocalExecutionStatus> {
  const currentGeneration = ++generation;
  status = { state: "starting", message: "Starting local execution…" };
  const work = pending.then(async () => {
    const current = executor; executor = null; await current?.stop();
    if (generation !== currentGeneration) return status;
    for (const deviceId of await listLocalExecutionDeviceIds()) await stopDesktopContainers(deviceId).catch(() => undefined);
    const bootstrap = await readBootstrapData();
    const settings = bootstrap.localExecutionSettings;
    if (!settings.enabled || !settings.storageRoot || !settings.serverBaseUrl || !bootstrap.token) {
      status = { state: "disabled", message: null }; return status;
    }
    executor = await startDesktopLocalExecutor({
      apiBaseUrl: settings.serverBaseUrl, token: bootstrap.token, deviceId: settings.deviceId,
      executorVersion: app.getVersion(), maxConcurrentRuns: settings.maxConcurrentRuns, storageBackendId: settings.storageBackendId, storageRoot: settings.storageRoot,
      scratchRoot: path.join(app.getPath("userData"), "scratch"),
      resourcesRoot: path.join(app.getPath("userData"), "sandbox-resources"), downloadConsent: settings.downloadConsent,
      onSandboxDownloadRequired: async (image) => {
        const bytes = await sandboxDownloadSize(image);
        if (generation !== currentGeneration) return false;
        const size = bytes === null ? "Download size is unavailable." : "Download: approximately " + (bytes / 1_000_000_000).toFixed(1) + " GB.";
        const result = await dialog.showMessageBox({ type: "question", buttons: ["Download", "Cancel"], defaultId: 0, cancelId: 1,
          title: "Download sandbox", message: "Download the Meowbert sandbox for local tasks?",
          detail: image.reference + "\n" + size + " Future sandbox updates download automatically." });
        if (generation !== currentGeneration || result.response !== 0) return false;
        const latest = await readBootstrapData();
        if (latest.localExecutionSettings.serverBaseUrl !== settings.serverBaseUrl) return false;
        await saveLocalExecutionSettings({ ...latest.localExecutionSettings, downloadConsent: true });
        return true;
      },
      onPendingReason: (message) => { if (generation === currentGeneration) status = { state: "running", message }; }
    });
    if (generation === currentGeneration) status = { state: "running", message: "Checking Docker and storage…" };
    return status;
  }).catch((error) => {
    if (generation === currentGeneration) status = { state: "error", message: error instanceof Error ? error.message : String(error) };
    return status;
  });
  pending = work;
  return work;
}

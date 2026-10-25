import type { LocalLiveFolder } from "@meowbert/shared";
import type { LiveFolderManager } from "../live-folders/manager";
import { stopDesktopContainers } from "../sandbox-image/resources";
import { LocalExecutionReadiness } from "./local-readiness";
import path from "node:path";
import { cleanupHostProcesses } from "./host-processes";
import type { ExecutorSettings } from "@meowbert/run-executor/agent/ports/executor-settings";
import os from "node:os";
import { isSupportedLocalExecutor } from "@meowbert/shared";
import type { SandboxImageReference } from "../sandbox-image/manager";
import { createDeviceApi, waitForDeviceRetry, type DeviceApiOptions } from "./device-api";
import { startLocalRun, type DeviceRunNotice } from "./local-run";
import { sandboxArchitecture } from "../sandbox-image/platform";

export interface LocalExecutionConfig { deviceWorkspaces?: Array<{ id: string; file_host: { kind: "device"; deviceId: string } }>; enabled: boolean; sandboxImage: SandboxImageReference; executorSettings: ExecutorSettings; storageMarkers: Record<string, { installId: string } | null> }
export interface DesktopLocalExecutorOptions extends DeviceApiOptions {
  liveDriveEnabled?: boolean; liveFolders?: LiveFolderManager;
  onLiveFolderConsent?: (folder: LocalLiveFolder) => Promise<boolean>;
  maxConcurrentRuns: number; deviceId: string; executorVersion: string; storageBackendId: string; storageRoot: string;
  scratchRoot: string; resourcesRoot: string; downloadConsent: boolean;
  workspaceRoots?: Record<string, string>;
  runsRoot?: string; hostSkillsRoot?: string; hostConsent?: boolean; hostShellEnabled?: boolean; computerUseEnabled?: boolean; hostBrowserEnabled?: boolean;
  onSandboxDownloadRequired?: (image: SandboxImageReference, unavailableReason?: string) => Promise<boolean>;
  onPendingReason?: (reason: string) => void;
}
export async function loadLocalExecutionConfig(options: DeviceApiOptions): Promise<LocalExecutionConfig> {
  return createDeviceApi(options, new AbortController().signal).request("/api/local-execution/config");
}

export async function startDesktopLocalExecutor(options: DesktopLocalExecutorOptions): Promise<{ stop: () => Promise<void> }> {
  sandboxArchitecture();
  if (!isSupportedLocalExecutor(process.platform, process.arch)) throw new Error("Local execution requires Apple Silicon macOS or Windows x64/arm64; sandbox mode also requires Docker Desktop.");
  const abort = new AbortController();
  const api = createDeviceApi(options, abort.signal);
  const route = "/api/devices/" + options.deviceId;
  const runs = new Map<string, ReturnType<typeof startLocalRun>>();
  const readiness = new LocalExecutionReadiness(options, api, abort.signal, runs);
  const awaitReport = () => { void readiness.report().catch(() => undefined); };
  const notice = (entries: unknown[]) => {
    if (!readiness.ready || abort.signal.aborted) return;
    for (const entry of entries as DeviceRunNotice[]) {
      if (entry.queue_state !== "admitted" || runs.has(entry.run_id)) continue;
      const target = entry.payload_json.executionTarget;
      if (target?.kind !== "local" || (target.mode === "host" ? !options.hostConsent : readiness.capabilities.sandboxImageReady !== true)) continue;
      const run = startLocalRun(options, api, entry, readiness.ready.image, readiness.ready.skillsRoot, readiness.ready.settings, readiness.ready.installId);
      runs.set(entry.run_id, run);
      void run.done.catch((error) => options.onPendingReason?.(String(error))).finally(() => runs.delete(entry.run_id));
    }
  };
  const heartbeat = async () => {
    while (!abort.signal.aborted) {
      await readiness.report().catch(() => undefined);
      await waitForDeviceRetry(abort.signal, 10_000);
    }
  };
  const setup = async () => {
    while (!abort.signal.aborted) {
      try { await api.request("/api/devices", "POST", { id: options.deviceId, name: os.hostname(), platform: process.platform, architecture: process.arch, executorVersion: options.executorVersion, maxConcurrentRuns: options.maxConcurrentRuns, capabilities: readiness.capabilities, consent: { hostMode: options.hostConsent === true, hostShell: options.hostConsent === true && options.hostShellEnabled === true, computerUse: options.computerUseEnabled === true, hostBrowser: options.hostBrowserEnabled === true } }); break; }
      catch (error) { options.onPendingReason?.(String(error)); await waitForDeviceRetry(abort.signal); }
    }
    if (abort.signal.aborted) return;
    const beat = heartbeat();
    const stream = (async () => {
      while (!abort.signal.aborted) {
        await api.stream(route + "/runs/stream", notice).catch(() => undefined);
        await waitForDeviceRetry(abort.signal);
      }
    })();
    try {
      while (!abort.signal.aborted) {
        await readiness.refresh().catch((error) => {
          readiness.capabilities.sandboxImageReady = false;
          readiness.capabilities.sandboxDownloadInProgress = false;
          awaitReport();
          options.onPendingReason?.((options.hostConsent && readiness.ready ? "Host mode ready. Sandbox unavailable: " : "") + (error instanceof Error ? error.message : String(error)));
        });
        await waitForDeviceRetry(abort.signal, 30_000);
      }
    } finally { await Promise.all([beat, stream]); }
  };
  await cleanupHostProcesses(options.runsRoot ?? path.join(options.scratchRoot, "../runs"));
  const background = setup().catch((error) => { options.onPendingReason?.(String(error)); abort.abort(); });
  return { stop: async () => {
    abort.abort();
    await Promise.all([...runs.values()].map((run) => run.fence()));
    await stopDesktopContainers(options.deviceId);
    void background;
  } };
}

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
import { type startLocalRun } from "./local-run";
import type { DesktopLocalExecutionStatus } from "../../shared";
import { RunAdmissions } from "./run-admissions";
import { RefreshQueue } from "./refresh-queue";
import { createCleanupScheduler } from "./cleanup-scheduler";
import { deviceRetryDelay } from "./retry-delay";
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
  onPendingReason?: (reason: string, run?: { taskId: string; runId: string }) => void;
  onRunStarted?: (taskId: string) => void;
  onStatus?: (status: DesktopLocalExecutionStatus) => void;
}
export async function loadLocalExecutionConfig(options: DeviceApiOptions): Promise<LocalExecutionConfig> {
  return createDeviceApi(options, new AbortController().signal).request("/api/local-execution/config");
}

export async function startDesktopLocalExecutor(options: DesktopLocalExecutorOptions): Promise<{ stop: () => Promise<void>; checkForUpdates: () => Promise<void> }> {
  sandboxArchitecture();
  if (!isSupportedLocalExecutor(process.platform, process.arch)) throw new Error("Local execution requires Apple Silicon macOS or Windows x64/arm64; sandbox mode also requires Docker Desktop.");
  const abort = new AbortController();
  const api = createDeviceApi(options, abort.signal);
  const route = "/api/devices/" + options.deviceId;
  const runs = new Map<string, ReturnType<typeof startLocalRun>>();
  let connected = false;
  const readiness = new LocalExecutionReadiness({ ...options, onStatus: (status) => options.onStatus?.(
    !connected ? { ...status, hostReady: false, sandboxReady: false,
      ...(status.state === "running" ? { state: "starting", message: "Waiting for task connection…" } : {}) } : status
  ) }, api, abort.signal, runs);
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshAttempt = 0;
  const cleanup = createCleanupScheduler(options, api, abort.signal, runs, () => admissions.resume());
  const admissions = new RunAdmissions(options, api, abort.signal, readiness, runs, cleanup.isBusy, () => { void cleanup.request(); });
  const checks = new RefreshQueue(async (force) => {
    clearTimeout(refreshTimer);
    if (abort.signal.aborted) return;
    try { await readiness.refresh(force); refreshAttempt = 0; admissions.resume(); }
    catch (error) {
      if (abort.signal.aborted) return;
      await readiness.failed(error); admissions.resume();
      // Retry failed server communication, never repeat successful Docker/storage probes on a timer.
      if (connected && (error instanceof TypeError || (error instanceof Error && error.name === "DeviceApiError"))) {
        refreshTimer = setTimeout(() => void checks.request(), deviceRetryDelay(refreshAttempt++));
        refreshTimer.unref();
      }
    }
  });
  const setup = async () => {
    let attempt = 0;
    while (!abort.signal.aborted) {
      try {
        await api.request("/api/devices", "POST", { id: options.deviceId, name: os.hostname(), platform: process.platform,
          architecture: process.arch, executorVersion: options.executorVersion, maxConcurrentRuns: options.maxConcurrentRuns,
          capabilities: readiness.capabilities, consent: { hostMode: options.hostConsent === true,
            hostShell: options.hostConsent === true && options.hostShellEnabled === true,
            computerUse: options.computerUseEnabled === true, hostBrowser: options.hostBrowserEnabled === true } });
        break;
      } catch (error) {
        if (abort.signal.aborted) return;
        readiness.status("error", String(error));
        await waitForDeviceRetry(abort.signal, deviceRetryDelay(attempt++));
      }
    }
    attempt = 0;
    while (!abort.signal.aborted) {
      const began = Date.now();
      try {
        await api.stream(route + "/runs/stream", (entries) => admissions.receive(entries), async (event, data) => {
          if (event === "ready") {
            if ((data as { executionEventsVersion?: number })?.executionEventsVersion !== 1) throw new Error("Update your Meowbert server to use event-driven local execution.");
            connected = true; void checks.request(); void cleanup.request();
          }
          if (event === "config") void checks.request();
          if (event === "cleanup") void cleanup.request();
          if (event === "ping") {
            const connectionId = (data as { connectionId?: string })?.connectionId;
            if (!connectionId) throw new Error("Missing device connection identifier.");
            await api.request(route + "/presence", "POST", { connectionId });
          }
        });
        connected = false;
        if (!abort.signal.aborted) readiness.status("error", "Connection lost. Reconnecting…");
      } catch (error) { connected = false; if (!abort.signal.aborted) readiness.status("error", String(error)); }
      connected = false; admissions.receive([]);
      if (Date.now() - began >= 30_000) attempt = 0;
      await waitForDeviceRetry(abort.signal, deviceRetryDelay(attempt++));
    }
  };
  await cleanupHostProcesses(options.runsRoot ?? path.join(options.scratchRoot, "../runs"));
  const background = setup().catch((error) => { options.onPendingReason?.(String(error)); abort.abort(); });
  return { checkForUpdates: async () => { await checks.request(true); await cleanup.request(); }, stop: async () => {
    abort.abort(); clearTimeout(refreshTimer);
    await Promise.all([...runs.values()].map((run) => run.fence()));
    await stopDesktopContainers(options.deviceId);
    void background;
  } };
}

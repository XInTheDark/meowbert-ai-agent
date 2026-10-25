import { applyDeviceTombstones } from "../workspace-files/tombstones";
import type { DesktopLocalExecutorOptions } from "./local-executor";
import type { DeviceApi } from "./device-api";
import type { startLocalRun } from "./local-run";
import { RefreshQueue } from "./refresh-queue";
import { deviceRetryDelay } from "./retry-delay";

export function createCleanupScheduler(options: DesktopLocalExecutorOptions, api: DeviceApi, signal: AbortSignal,
  runs: Map<string, ReturnType<typeof startLocalRun>>, onIdle: () => void = () => {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let busy = false;
  const queue = new RefreshQueue(async () => {
    clearTimeout(timer);
    if (signal.aborted) return;
    busy = true;
    let delay: number | null = null;
    try {
      const result = await applyDeviceTombstones({ api, deviceId: options.deviceId, scratchRoot: options.scratchRoot,
        workspaceRoots: options.workspaceRoots ?? {}, activeWorkspaceIds: new Set([...runs.values()].map((run) => run.workspaceId)) });
      if (result.nextCheckInMs !== null) delay = Math.max(500, result.nextCheckInMs);
      if (result.retryNeeded) delay = Math.min(delay ?? Infinity, deviceRetryDelay(attempt++));
      else attempt = 0;
    } catch (error) {
      options.onPendingReason?.("Workspace cleanup failed: " + String(error)); delay = deviceRetryDelay(attempt++);
    }
    busy = false; onIdle();
    if (delay !== null && !signal.aborted) {
      timer = setTimeout(() => void queue.request(), Math.min(2_147_483_647, delay)); timer.unref();
    }
  });
  signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return { request: () => queue.request(), isBusy: () => busy };
}

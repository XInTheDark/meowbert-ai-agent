import type { ManagedSandboxContainerSummary } from "@meowbert/shared/docker-sandbox";
import { apiSandboxManager } from "./sandbox.js";

const SANDBOX_CLEANUP_INTERVAL_MS = 60_000;

interface SandboxCleanupManager {
  getCurrentContainerId(): string | null;
  listManagedContainers(): Promise<ManagedSandboxContainerSummary[]>;
  stopAndRemoveContainer(containerId: string): Promise<void>;
}

function isSessionOnlyShellContainer(container: ManagedSandboxContainerSummary): boolean {
  return container.purpose === "shell-session"
    && !container.taskId
    && !container.runId;
}

// The API no longer keeps session-only shells alive (retired terminals and canvas dev servers),
// so any it still owns are orphans.
function shouldRemoveApiSandbox(container: ManagedSandboxContainerSummary, currentParentContainerId: string): boolean {
  if (container.parentContainerId !== currentParentContainerId) {
    return false;
  }

  return container.state !== "running" || isSessionOnlyShellContainer(container);
}

export async function cleanupApiSandboxOrphansOnce(
  manager: SandboxCleanupManager = apiSandboxManager
): Promise<number> {
  const currentParentContainerId = manager.getCurrentContainerId();
  if (!currentParentContainerId) {
    return 0;
  }

  const containers = await manager.listManagedContainers();
  const containersToRemove = containers.filter((container) => shouldRemoveApiSandbox(container, currentParentContainerId));

  for (const container of containersToRemove) {
    await manager.stopAndRemoveContainer(container.containerId);
  }

  return containersToRemove.length;
}

export function startApiSandboxCleanupLoop(
  manager: SandboxCleanupManager = apiSandboxManager
): { stop: () => Promise<void> } {
  let stopping = false;
  let running = false;
  let interval: NodeJS.Timeout | null = null;
  let pendingRun: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    if (stopping || running) {
      return;
    }

    running = true;
    pendingRun = cleanupApiSandboxOrphansOnce(manager)
      .then((removedCount) => {
        if (removedCount > 0) {
          console.log(`[sandbox] Removed ${removedCount} orphan API sandbox container(s)`);
        }
      })
      .catch((error) => {
        console.error("[sandbox] Failed to clean orphan API sandbox containers", error);
      })
      .finally(() => {
        running = false;
        pendingRun = null;
      });

    await pendingRun;
  };

  void runOnce();
  interval = setInterval(() => {
    void runOnce();
  }, SANDBOX_CLEANUP_INTERVAL_MS);

  return {
    stop: async (): Promise<void> => {
      stopping = true;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (pendingRun) {
        await pendingRun;
      }
    }
  };
}

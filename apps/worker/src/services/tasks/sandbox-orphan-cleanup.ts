import type { ManagedSandboxContainerSummary } from "@meowbert/shared/docker-sandbox";
import { query } from "../../lib/db.js";
import { workerSandboxManager } from "../runtime/sandbox.js";

const SANDBOX_ORPHAN_CLEANUP_INTERVAL_MS = 60_000;

interface ActiveTaskRunRow {
  task_id: string;
  run_id: string;
}

interface ActivePersistentShellSessionRow {
  id: string;
}

interface SandboxCleanupManager {
  getCurrentContainerId(): string | null;
  listManagedContainers(): Promise<ManagedSandboxContainerSummary[]>;
  stopAndRemoveContainer(containerId: string): Promise<void>;
}

function isTaskBoundSandbox(container: ManagedSandboxContainerSummary): boolean {
  if (!container.taskId || !container.runId) {
    return false;
  }

  return container.purpose === "task-run" || container.purpose === "shell-session";
}

function shouldRemoveWorkerSandbox(input: {
  container: ManagedSandboxContainerSummary;
  activeRunLookup: Set<string>;
  activePersistentSessionLookup: Set<string>;
  currentParentContainerId: string | null;
}): boolean {
  const { container, activeRunLookup, activePersistentSessionLookup, currentParentContainerId } = input;
  if (container.purpose === "shell-session" && container.sessionId) {
    return container.state !== "running" || !activePersistentSessionLookup.has(container.sessionId);
  }

  const isTaskBound = isTaskBoundSandbox(container);
  const isSameParentContainer = currentParentContainerId !== null
    && container.parentContainerId === currentParentContainerId;

  if (container.state !== "running") {
    return isTaskBound || isSameParentContainer;
  }

  if (!isTaskBound) {
    return false;
  }

  return !activeRunLookup.has(`${container.taskId}:${container.runId}`);
}

async function buildActiveTaskRunLookup(): Promise<Set<string>> {
  const result = await query<ActiveTaskRunRow>(
    `SELECT
        t.id AS task_id,
        active_run.id AS run_id
       FROM tasks t
       JOIN LATERAL (
         SELECT tr.id
           FROM task_runs tr
          WHERE tr.task_id = t.id
            AND tr.ended_at IS NULL
          ORDER BY tr.attempt_no DESC, tr.id DESC
          LIMIT 1
       ) AS active_run ON true
      WHERE t.status IN ('starting', 'running')
        AND t.trashed_at IS NULL`
  );

  return new Set(result.rows.map((row) => `${row.task_id}:${row.run_id}`));
}

async function buildActivePersistentSessionLookup(): Promise<Set<string>> {
  const result = await query<ActivePersistentShellSessionRow>(
    `SELECT id
       FROM persistent_shell_sessions
      WHERE status IN ('starting', 'running', 'idle')`
  );

  return new Set(result.rows.map((row) => row.id));
}

export async function cleanupSandboxOrphansOnce(
  manager: SandboxCleanupManager = workerSandboxManager
): Promise<number> {
  const [activeRunLookup, activePersistentSessionLookup, containers] = await Promise.all([
    buildActiveTaskRunLookup(),
    buildActivePersistentSessionLookup(),
    manager.listManagedContainers()
  ]);
  const currentParentContainerId = manager.getCurrentContainerId();
  const containersToRemove = containers.filter((container) => shouldRemoveWorkerSandbox({
    container,
    activeRunLookup,
    activePersistentSessionLookup,
    currentParentContainerId
  }));

  for (const container of containersToRemove) {
    await manager.stopAndRemoveContainer(container.containerId);
  }

  return containersToRemove.length;
}

export function startSandboxOrphanCleanupLoop(
  manager: SandboxCleanupManager = workerSandboxManager
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
    pendingRun = cleanupSandboxOrphansOnce(manager)
      .then((removedCount) => {
        if (removedCount > 0) {
          console.log(`[sandbox] Removed ${removedCount} orphan sandbox container(s)`);
        }
      })
      .catch((error) => {
        console.error("[sandbox] Failed to clean orphan sandbox containers", error);
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
  }, SANDBOX_ORPHAN_CLEANUP_INTERVAL_MS);

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

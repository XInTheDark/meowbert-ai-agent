import type { ManagedSandboxContainerSummary } from "@meowbert/shared/docker-sandbox";
import { query } from "../../lib/db.js";
import { workerSandboxManager } from "../runtime/sandbox.js";
import { listWarmSandboxContainerIds } from "../run-host/warm-sandboxes.js";

const SANDBOX_ORPHAN_CLEANUP_INTERVAL_MS = 60_000;
// shell-exec containers list a skill's tools and stop within seconds; one this old was leaked.
const SHELL_EXEC_MAX_AGE_MS = 5 * 60_000;
// A run creates its sandbox right after its row turns active, and a loaded Docker host can take
// tens of seconds to create and start one, so a young sandbox is never judged by run state alone.
const NEW_SANDBOX_GRACE_MS = 2 * 60_000;

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
  listRunningContainerIds(): Promise<string[]>;
  stopAndRemoveContainer(containerId: string): Promise<void>;
}

function isTaskBoundSandbox(container: ManagedSandboxContainerSummary): boolean {
  if (!container.taskId || !container.runId) {
    return false;
  }

  return container.purpose === "task-run" || container.purpose === "shell-session";
}

function isSameContainerId(left: string, right: string): boolean {
  return left.startsWith(right) || right.startsWith(left);
}

// Parent labels may hold a short ID, so match by prefix. When this worker cannot find its own
// ID among running containers, its view of IDs does not match Docker's, and no parent is judged gone.
function buildParentGoneCheck(
  runningContainerIds: string[],
  currentParentContainerId: string | null
): (parentContainerId: string | null) => boolean {
  const lookupMatchesDocker = currentParentContainerId !== null
    && runningContainerIds.some((id) => isSameContainerId(id, currentParentContainerId));
  return (parentContainerId) => lookupMatchesDocker
    && parentContainerId !== null
    && !runningContainerIds.some((id) => isSameContainerId(id, parentContainerId));
}

function isExpiredShellExec(container: ManagedSandboxContainerSummary, nowMs: number): boolean {
  if (container.purpose !== "shell-exec" || !container.createdAt) {
    return false;
  }
  return nowMs - Date.parse(container.createdAt) > SHELL_EXEC_MAX_AGE_MS;
}

function isStartingUp(container: ManagedSandboxContainerSummary, nowMs: number): boolean {
  if (container.state !== "created" && container.state !== "running") {
    return false;
  }
  const createdMs = container.createdAt ? Date.parse(container.createdAt) : Number.NaN;
  return Number.isFinite(createdMs) && nowMs - createdMs < NEW_SANDBOX_GRACE_MS;
}

function shouldRemoveWorkerSandbox(input: {
  container: ManagedSandboxContainerSummary;
  activeRunLookup: Set<string>;
  activePersistentSessionLookup: Set<string>;
  currentParentContainerId: string | null;
  isParentGone: (parentContainerId: string | null) => boolean;
  warmContainerIds: Set<string>;
  nowMs: number;
}): boolean {
  const { container, activeRunLookup, activePersistentSessionLookup, currentParentContainerId } = input;
  // Persistent shell sessions outlive the process that started them, so only their DB row decides.
  if (container.purpose === "shell-session" && container.sessionId) {
    return container.state !== "running" || !activePersistentSessionLookup.has(container.sessionId);
  }

  // Only the process that created a sandbox holds its handle, so once that process is gone nothing can use it.
  if (input.isParentGone(container.parentContainerId)) {
    return true;
  }

  // A task's warm sandbox outlives its run until the warm window ends.
  if (container.state === "running" && [...input.warmContainerIds].some((id) => isSameContainerId(id, container.containerId))) {
    return false;
  }

  if (isStartingUp(container, input.nowMs)) {
    return false;
  }

  const isTaskBound = isTaskBoundSandbox(container);
  const isSameParentContainer = currentParentContainerId !== null
    && container.parentContainerId === currentParentContainerId;

  if (container.state !== "running") {
    return isTaskBound || isSameParentContainer;
  }

  if (isExpiredShellExec(container, input.nowMs)) {
    return true;
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
  manager: SandboxCleanupManager = workerSandboxManager,
  listWarmContainerIds: () => Promise<Set<string>> = listWarmSandboxContainerIds
): Promise<number> {
  // List containers before reading active runs: Docker listing can take seconds under load, and a
  // run snapshot taken earlier would miss runs that started (and created sandboxes) in between.
  const [containers, runningContainerIds] = await Promise.all([
    manager.listManagedContainers(),
    manager.listRunningContainerIds()
  ]);
  const [activeRunLookup, activePersistentSessionLookup] = await Promise.all([
    buildActiveTaskRunLookup(),
    buildActivePersistentSessionLookup()
  ]);
  const warmContainerIds = await listWarmContainerIds().catch(() => new Set<string>());
  const currentParentContainerId = manager.getCurrentContainerId();
  const isParentGone = buildParentGoneCheck(runningContainerIds, currentParentContainerId);
  const nowMs = Date.now();
  const containersToRemove = containers.filter((container) => shouldRemoveWorkerSandbox({
    container,
    activeRunLookup,
    activePersistentSessionLookup,
    currentParentContainerId,
    isParentGone,
    warmContainerIds,
    nowMs
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

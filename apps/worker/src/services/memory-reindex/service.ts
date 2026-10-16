import { MEMORY_REINDEX_EVENT_CHANNEL } from "@meowbert/shared";
import { redis } from "../../lib/redis.js";
import { syncWorkspaceMemoryOnce } from "../memory/index.js";
import { resolveTaskWorkspaceRoot } from "../workspaces/workspace-storage.js";
import {
  claimReindexJob,
  finishReindexJob,
  listMemoryEnabledWorkspaces,
  markWorkspaceFinished,
  markWorkspaceStarted,
  setReindexTotal,
  touchReindexJob,
  type ClaimedReindexJob,
  type ReindexWorkspace
} from "./job-store.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
// Picks up jobs left behind by a worker that stopped mid-run once their heartbeat goes stale.
const STALE_JOB_POLL_INTERVAL_MS = 5 * 60_000;

function workspaceLabel(workspace: ReindexWorkspace): string {
  return `${workspace.name} (${workspace.id.slice(0, 8)})`;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, run: (item: T) => Promise<boolean>): Promise<void> {
  let next = 0;
  let stopped = false;
  const lane = async () => {
    while (!stopped && next < items.length) {
      const item = items[next];
      next += 1;
      if (!(await run(item))) {
        stopped = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
}

async function reindexWorkspace(workspace: ReindexWorkspace): Promise<string | null> {
  try {
    const workspaceRoot = await resolveTaskWorkspaceRoot({
      workspaceId: workspace.id,
      rootPath: workspace.root_path ?? "",
      storageBackendId: workspace.storage_backend_id
    });
    const status = await syncWorkspaceMemoryOnce(workspaceRoot);
    return status?.state === "error" ? status.error ?? "Memory indexing failed." : null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function runReindexJob(job: ClaimedReindexJob, isStopping: () => boolean): Promise<void> {
  const workspaces = await listMemoryEnabledWorkspaces();
  await setReindexTotal(job.id, workspaces.length);
  const heartbeat = setInterval(() => {
    void touchReindexJob(job.id).catch((error) => console.error("Memory re-index heartbeat failed", error));
  }, HEARTBEAT_INTERVAL_MS);

  try {
    await runWithConcurrency(workspaces, job.concurrency, async (workspace) => {
      const label = workspaceLabel(workspace);
      if (isStopping() || !(await markWorkspaceStarted(job.id, label))) {
        return false;
      }
      await markWorkspaceFinished(job.id, label, await reindexWorkspace(workspace));
      return true;
    });
  } finally {
    clearInterval(heartbeat);
  }
  // A shutdown leaves the job running; another worker resumes it once the heartbeat goes stale.
  if (!isStopping()) {
    await finishReindexJob(job.id);
  }
}

export function startMemoryReindexListener(): { stop: () => Promise<void> } {
  const subscriber = redis.duplicate();
  let running: Promise<void> | null = null;
  let rerun = false;
  let stopping = false;

  const runPending = (): void => {
    if (running) {
      rerun = true;
      return;
    }
    running = (async () => {
      do {
        rerun = false;
        const job = await claimReindexJob();
        if (job) {
          await runReindexJob(job, () => stopping);
        }
      } while (rerun && !stopping);
    })()
      .catch((error) => console.error("Memory re-index failed", error))
      .finally(() => { running = null; });
  };

  subscriber.on("message", () => runPending());
  subscriber.on("error", (error) => console.error("Memory re-index listener failed", error));
  void subscriber.subscribe(MEMORY_REINDEX_EVENT_CHANNEL)
    .catch((error) => console.error("Unable to subscribe to memory re-index events", error));
  runPending();
  const stalePoll = setInterval(runPending, STALE_JOB_POLL_INTERVAL_MS);

  return {
    stop: async () => {
      stopping = true;
      clearInterval(stalePoll);
      await running;
      await subscriber.unsubscribe(MEMORY_REINDEX_EVENT_CHANNEL).catch(() => undefined);
      await subscriber.quit();
    }
  };
}

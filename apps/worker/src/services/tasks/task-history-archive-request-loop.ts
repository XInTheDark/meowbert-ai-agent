import {
  claimNextManualArchiveRun,
  failArchiveRun
} from "./task-history-archive-activity.js";
import { runTaskHistoryArchivePass } from "./task-history-archive-loop.js";

const TASK_HISTORY_ARCHIVE_REQUEST_INTERVAL_MS = 5_000;

export async function processTaskHistoryArchiveRequestOnce(): Promise<boolean> {
  const runId = await claimNextManualArchiveRun();
  if (!runId) {
    return false;
  }

  try {
    await runTaskHistoryArchivePass({
      activityRunId: runId,
      triggerSource: "manual"
    });
  } catch (error) {
    await failArchiveRun(runId, error).catch(() => undefined);
    throw error;
  }
  return true;
}

export function startTaskHistoryArchiveRequestLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let running = false;
  let pendingRun: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    if (stopping || running) {
      return;
    }
    running = true;
    pendingRun = processTaskHistoryArchiveRequestOnce()
      .then((processed) => {
        if (processed) {
          console.log("[task-history] Processed manual archive request");
        }
      })
      .catch((error) => {
        console.error("[task-history] Manual archive request failed", error);
      })
      .finally(() => {
        running = false;
        pendingRun = null;
      });
    await pendingRun;
  };

  void runOnce();
  const interval = setInterval(() => {
    void runOnce();
  }, TASK_HISTORY_ARCHIVE_REQUEST_INTERVAL_MS);

  return {
    stop: async (): Promise<void> => {
      stopping = true;
      clearInterval(interval);
      if (pendingRun) {
        await pendingRun;
      }
    }
  };
}

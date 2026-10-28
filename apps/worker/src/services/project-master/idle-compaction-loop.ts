import { listenToPgChannel } from "../../lib/pg-listen.js";
import { compactIdleMasterIfDue, listRecentlyIdleMasters } from "./idle-compaction.js";
import { createMasterCheckScheduler } from "./master-check-scheduler.js";

const IDLE_CHANNEL = "project_master_idle";
// Notifications set each Master's timer. The sweep only catches up after a restart or a dropped connection.
const SAFETY_SWEEP_MS = 10 * 60_000;
const SWEEP_BATCH_SIZE = 200;

// Compacts a Master's context when it goes idle, timed so the compaction still reads the prompt cache.
export function startProjectMasterIdleCompactionLoop(): { stop: () => Promise<void> } {
  const scheduler = createMasterCheckScheduler("Idle compaction", async (masterTaskId) => {
    const outcome = await compactIdleMasterIfDue(masterTaskId);
    return outcome.kind === "due_later" ? outcome.delayMs : null;
  });

  const sweep = async () => {
    try {
      const masterTaskIds = await listRecentlyIdleMasters(SWEEP_BATCH_SIZE);
      for (const masterTaskId of masterTaskIds) await scheduler.check(masterTaskId);
    } catch (error) {
      console.error("Project Master idle compaction sweep failed", error);
    }
  };

  const listener = listenToPgChannel({
    channel: IDLE_CHANNEL,
    onNotification: (payload) => {
      if (payload) void scheduler.check(payload);
    },
    onReconnect: () => void sweep()
  });
  const sweepTimer = setInterval(() => void sweep(), SAFETY_SWEEP_MS);
  sweepTimer.unref();
  void sweep();

  return {
    stop: async () => {
      clearInterval(sweepTimer);
      await listener.stop();
      await scheduler.stop();
    }
  };
}

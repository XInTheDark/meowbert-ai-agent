import { listenToPgChannel } from "../../lib/pg-listen.js";
import { createMasterCheckScheduler } from "../project-master/master-check-scheduler.js";
import { compactIdleTaskIfDue } from "./idle-compaction.js";
import { listRecentlyIdleTasks } from "./idle-task.js";

const IDLE_CHANNEL = "task_idle";
// Notifications set each task's timer. The sweep only catches up after a restart or a dropped connection.
const SAFETY_SWEEP_MS = 10 * 60_000;
const SWEEP_BATCH_SIZE = 200;

// Compacts a task's context when it goes idle, timed so the compaction still reads the prompt cache.
export function startIdleCompactionLoop(): { stop: () => Promise<void> } {
  const scheduler = createMasterCheckScheduler("Idle compaction", async (taskId) => {
    const outcome = await compactIdleTaskIfDue(taskId);
    return outcome.kind === "due_later" ? outcome.delayMs : null;
  });

  const sweep = async () => {
    try {
      const taskIds = await listRecentlyIdleTasks(SWEEP_BATCH_SIZE);
      for (const taskId of taskIds) await scheduler.check(taskId);
    } catch (error) {
      console.error("Idle compaction sweep failed", error);
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

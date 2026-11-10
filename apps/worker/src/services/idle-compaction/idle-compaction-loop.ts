import { listenToPgChannel } from "../../lib/pg-listen.js";
import { createMasterCheckScheduler } from "../project-master/master-check-scheduler.js";
import { checkIdleTask } from "./idle-task-check.js";
import { listRecentlyIdleTasks } from "./idle-task.js";

const IDLE_CHANNEL = "task_idle";
// Notifications set each task's timer. The sweep only catches up after a restart or a dropped connection.
const SAFETY_SWEEP_MS = 10 * 60_000;
const SWEEP_BATCH_SIZE = 200;

// Looks after a task once it goes idle: cachebeat keeps its prompt cache warm, then idle compaction
// compacts its context, timed so the compaction still reads that cache.
export function startIdleCompactionLoop(): { stop: () => Promise<void> } {
  const scheduler = createMasterCheckScheduler("Idle task check", checkIdleTask);

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

import { listenToPgChannel } from "../../lib/pg-listen.js";
import { createMasterCheckScheduler } from "./master-check-scheduler.js";
import { listMastersWithPendingReports, wakeMasterIfDue } from "./wake.js";

const WAKE_CHANNEL = "project_master_wake";
// Notifications do the real work. The sweep only catches up after a restart or a dropped connection.
const SAFETY_SWEEP_MS = 5 * 60_000;
const SWEEP_BATCH_SIZE = 50;

// Wakes Masters when the database says a report landed or a busy Master went idle, and holds a
// timer per Master while its reports wait for a quiet moment.
export function startProjectMasterWakeLoop(): { stop: () => Promise<void> } {
  const scheduler = createMasterCheckScheduler("Wake", async (masterTaskId) => {
    const outcome = await wakeMasterIfDue(masterTaskId);
    return outcome.kind === "due_later" ? outcome.delayMs : null;
  });

  const sweep = async () => {
    try {
      const masterTaskIds = await listMastersWithPendingReports(SWEEP_BATCH_SIZE);
      for (const masterTaskId of masterTaskIds) await scheduler.check(masterTaskId);
    } catch (error) {
      console.error("Project Master wake sweep failed", error);
    }
  };

  const listener = listenToPgChannel({
    channel: WAKE_CHANNEL,
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

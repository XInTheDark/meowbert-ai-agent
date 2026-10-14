import { listenToPgChannel } from "../../lib/pg-listen.js";
import { listMastersWithPendingReports, wakeMasterIfDue } from "./wake.js";

const WAKE_CHANNEL = "project_master_wake";
// Notifications do the real work. The sweep only catches up after a restart or a dropped connection.
const SAFETY_SWEEP_MS = 5 * 60_000;
const SWEEP_BATCH_SIZE = 50;

// Wakes Masters when the database says a report landed or a busy Master went idle, and holds a
// timer per Master while its reports wait for a quiet moment.
export function startProjectMasterWakeLoop(): { stop: () => Promise<void> } {
  const timers = new Map<string, NodeJS.Timeout>();
  const inFlight = new Map<string, Promise<void>>();
  let stopping = false;

  const schedule = (masterTaskId: string, delayMs: number) => {
    if (stopping) return;
    clearTimeout(timers.get(masterTaskId));
    const timer = setTimeout(() => {
      timers.delete(masterTaskId);
      void check(masterTaskId);
    }, delayMs);
    timer.unref();
    timers.set(masterTaskId, timer);
  };

  // A notification that lands mid-check may describe state the check could not see, so check again.
  const rerun = new Set<string>();
  const check = (masterTaskId: string): Promise<void> => {
    if (stopping) return Promise.resolve();
    const running = inFlight.get(masterTaskId);
    if (running) {
      rerun.add(masterTaskId);
      return running;
    }
    const pending = wakeMasterIfDue(masterTaskId)
      .then((outcome) => {
        if (outcome.kind === "due_later") schedule(masterTaskId, outcome.delayMs);
      })
      .catch((error) => console.error(`Failed to wake Project Master ${masterTaskId}`, error))
      .finally(() => {
        inFlight.delete(masterTaskId);
        if (rerun.delete(masterTaskId)) void check(masterTaskId);
      });
    inFlight.set(masterTaskId, pending);
    return pending;
  };

  const sweep = async () => {
    try {
      const masterTaskIds = await listMastersWithPendingReports(SWEEP_BATCH_SIZE);
      for (const masterTaskId of masterTaskIds) await check(masterTaskId);
    } catch (error) {
      console.error("Project Master wake sweep failed", error);
    }
  };

  const listener = listenToPgChannel({
    channel: WAKE_CHANNEL,
    onNotification: (payload) => {
      if (payload) void check(payload);
    },
    onReconnect: () => void sweep()
  });
  const sweepTimer = setInterval(() => void sweep(), SAFETY_SWEEP_MS);
  sweepTimer.unref();
  void sweep();

  return {
    stop: async () => {
      stopping = true;
      clearInterval(sweepTimer);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await listener.stop();
      await Promise.all(inFlight.values());
    }
  };
}

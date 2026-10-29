// setTimeout fires immediately past this, so longer waits are rechecked at the limit.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface MasterCheckScheduler {
  check: (masterTaskId: string) => Promise<void>;
  stop: () => Promise<void>;
}

// Runs one check at a time per Master and holds a timer for each Master whose check comes due later.
// `runCheck` returns the delay until the next check, or null when nothing is pending.
export function createMasterCheckScheduler(
  label: string,
  runCheck: (masterTaskId: string) => Promise<number | null>
): MasterCheckScheduler {
  const timers = new Map<string, NodeJS.Timeout>();
  const inFlight = new Map<string, Promise<void>>();
  // A notification that lands mid-check may describe state the check could not see, so check again.
  const rerun = new Set<string>();
  let stopping = false;

  const schedule = (masterTaskId: string, delayMs: number) => {
    if (stopping) return;
    clearTimeout(timers.get(masterTaskId));
    const timer = setTimeout(() => {
      timers.delete(masterTaskId);
      void check(masterTaskId);
    }, Math.min(delayMs, MAX_TIMER_DELAY_MS));
    timer.unref();
    timers.set(masterTaskId, timer);
  };

  const check = (masterTaskId: string): Promise<void> => {
    if (stopping) return Promise.resolve();
    const running = inFlight.get(masterTaskId);
    if (running) {
      rerun.add(masterTaskId);
      return running;
    }
    const pending = runCheck(masterTaskId)
      .then((delayMs) => {
        if (delayMs !== null) schedule(masterTaskId, delayMs);
      })
      .catch((error) => console.error(`${label} failed for task ${masterTaskId}`, error))
      .finally(() => {
        inFlight.delete(masterTaskId);
        if (rerun.delete(masterTaskId)) void check(masterTaskId);
      });
    inFlight.set(masterTaskId, pending);
    return pending;
  };

  return {
    check,
    stop: async () => {
      stopping = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await Promise.all(inFlight.values());
    }
  };
}

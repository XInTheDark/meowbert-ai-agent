const SLOT_POLL_INTERVAL_MS = 2_000;
const SLOT_WAIT_TIMEOUT_MS = 10 * 60_000;

export interface SandboxSlotWaitInput {
  limit: number;
  countActive: () => Promise<number>;
  onWaiting?: (active: number) => Promise<void> | void;
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until fewer than `limit` sandboxes are active on the Docker host.
 * Resolves with how long it waited (0 when a slot was free right away) and
 * throws once the wait exceeds `timeoutMs`, so a full host fails a run
 * instead of stalling it forever.
 */
export async function waitForSandboxSlot(input: SandboxSlotWaitInput): Promise<{ waitedMs: number }> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const pollIntervalMs = input.pollIntervalMs ?? SLOT_POLL_INTERVAL_MS;
  const timeoutMs = input.timeoutMs ?? SLOT_WAIT_TIMEOUT_MS;
  const startedAt = now();

  let active = await input.countActive();
  if (active < input.limit) {
    return { waitedMs: 0 };
  }

  await input.onWaiting?.(active);
  while (active >= input.limit) {
    if (now() - startedAt >= timeoutMs) {
      throw new Error(
        `All ${input.limit} sandbox slots on this Docker host stayed in use for ${Math.round(timeoutMs / 60_000)} minutes. `
        + "Wait for other tasks to finish, or raise runtime.sandbox.maxRunningContainers if the host has memory to spare."
      );
    }
    await sleep(pollIntervalMs);
    active = await input.countActive();
  }

  return { waitedMs: now() - startedAt };
}

/** Runs callbacks one at a time, so this process checks capacity and creates a container without racing itself. */
export function createSerialGate(): <T>(callback: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(callback: () => Promise<T>): Promise<T> => {
    const run = tail.then(callback, callback);
    tail = run.catch(() => undefined);
    return run;
  };
}

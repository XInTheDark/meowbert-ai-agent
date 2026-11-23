const SLOT_POLL_INTERVAL_MS = 2_000;
const SLOT_WAIT_TIMEOUT_MS = 10 * 60_000;
const MAX_RESERVED_TASK_SLOTS = 16;
const CAPACITY_ERROR_MARKER = "sandbox slots on this Docker host stayed in use";

export interface SandboxSlotWaitInput {
  limit: number;
  countActive: () => Promise<number>;
  onWaiting?: (active: number) => Promise<void> | void;
  // Frees a slot when it can, such as by stopping an idle warm sandbox; true when it freed one.
  relieve?: () => Promise<boolean>;
  // Ends the wait early, such as when the run that needs the sandbox is stopped or interrupted.
  signal?: AbortSignal;
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Sandbox creation was cancelled.");
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(abortReason(signal));
    return;
  }
  const onAbort = (): void => {
    clearTimeout(timer);
    reject(abortReason(signal!));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

// True for the error a run gets when the host stayed full for the whole wait. Callers see the
// message only, since skill startup rewraps errors.
export function isSandboxCapacityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(CAPACITY_ERROR_MARKER);
}

/**
 * Waits until fewer than `limit` sandboxes are active on the Docker host.
 * Resolves with how long it waited (0 when a slot was free right away) and
 * throws once the wait exceeds `timeoutMs`, so a full host fails a run
 * instead of stalling it forever. An aborted `signal` ends the wait with its reason.
 */
export async function waitForSandboxSlot(input: SandboxSlotWaitInput): Promise<{ waitedMs: number }> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const pollIntervalMs = input.pollIntervalMs ?? SLOT_POLL_INTERVAL_MS;
  const timeoutMs = input.timeoutMs ?? SLOT_WAIT_TIMEOUT_MS;
  const startedAt = now();

  throwIfAborted(input.signal);
  let active = await input.countActive();
  while (active >= input.limit && (await input.relieve?.()) === true) {
    throwIfAborted(input.signal);
    active = await input.countActive();
  }
  if (active < input.limit) {
    return { waitedMs: 0 };
  }

  await input.onWaiting?.(active);
  while (active >= input.limit) {
    throwIfAborted(input.signal);
    if (now() - startedAt >= timeoutMs) {
      throw new Error(
        `All ${input.limit} ${CAPACITY_ERROR_MARKER} for ${Math.round(timeoutMs / 60_000)} minutes. `
        + "Wait for other tasks to finish, or raise runtime.sandbox.maxRunningContainers if the host has memory to spare."
      );
    }
    await sleep(pollIntervalMs, input.signal);
    active = await input.countActive();
  }

  return { waitedMs: now() - startedAt };
}

export interface ShellSessionCapacityInput {
  limit: number;
  countActive: () => Promise<number>;
  countShellSessions: () => Promise<number>;
  relieve?: () => Promise<boolean>;
  signal?: AbortSignal;
}

/**
 * Caps persistent shell sessions below the host's total sandbox limit so they
 * always leave headroom for task runs and short-lived tool sandboxes.
 */
export function resolveShellSessionLimit(maxRunningContainers: number): number {
  if (maxRunningContainers <= 1) return maxRunningContainers;
  const reserved = Math.max(1, Math.min(MAX_RESERVED_TASK_SLOTS, Math.floor(maxRunningContainers / 4)));
  return maxRunningContainers - reserved;
}

/**
 * Fails fast when a persistent shell session cannot claim a slot, rather than
 * waiting up to 10 minutes or consuming headroom reserved for task runs.
 */
export async function assertShellSessionCapacity(input: ShellSessionCapacityInput): Promise<void> {
  throwIfAborted(input.signal);
  const shellLimit = resolveShellSessionLimit(input.limit);
  const shellCount = await input.countShellSessions();
  if (shellCount >= shellLimit) {
    const reserved = input.limit - shellLimit;
    throw new Error(
      `Cannot start a new persistent shell session: all ${shellLimit} persistent shell slots on this Docker host are in use`
      + (reserved > 0 ? ` (${reserved} of ${input.limit} total sandbox slots are reserved for task runs)` : "")
      + ". Terminate idle shell sessions first, or raise runtime.sandbox.maxRunningContainers."
    );
  }

  let active = await input.countActive();
  while (active >= input.limit && (await input.relieve?.()) === true) {
    throwIfAborted(input.signal);
    active = await input.countActive();
  }
  if (active >= input.limit) {
    throw new Error(
      `Cannot start a new persistent shell session: all ${input.limit} sandbox slots on this Docker host are in use. `
      + "Terminate idle shell sessions or wait for running tasks to finish, or raise runtime.sandbox.maxRunningContainers."
    );
  }
}

export interface ClaimSandboxSlotInput<T> extends SandboxSlotWaitInput {
  gate: SerialGate;
  claim: () => Promise<T>;
}

/**
 * Waits for a free sandbox slot and claims it atomically under `gate`, releasing
 * `gate` between polls so waiting callers never block other sandbox operations.
 */
export async function claimSandboxSlot<T>(input: ClaimSandboxSlotInput<T>): Promise<{ value: T; waitedMs: number }> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const pollIntervalMs = input.pollIntervalMs ?? SLOT_POLL_INTERVAL_MS;
  const timeoutMs = input.timeoutMs ?? SLOT_WAIT_TIMEOUT_MS;
  const startedAt = now();
  let notifiedWaiting = false;

  for (;;) {
    throwIfAborted(input.signal);
    const attempt = await input.gate(
      async (): Promise<{ claimed: true; value: T } | { claimed: false; active: number }> => {
        throwIfAborted(input.signal);
        let active = await input.countActive();
        while (active >= input.limit && (await input.relieve?.()) === true) {
          throwIfAborted(input.signal);
          active = await input.countActive();
        }
        if (active < input.limit) {
          throwIfAborted(input.signal);
          return { claimed: true, value: await input.claim() };
        }
        return { claimed: false, active };
      },
      input.signal
    );

    if (attempt.claimed) {
      return { value: attempt.value, waitedMs: now() - startedAt };
    }

    if (!notifiedWaiting) {
      notifiedWaiting = true;
      await input.onWaiting?.(attempt.active);
    }
    throwIfAborted(input.signal);
    if (now() - startedAt >= timeoutMs) {
      throw new Error(
        `All ${input.limit} ${CAPACITY_ERROR_MARKER} for ${Math.round(timeoutMs / 60_000)} minutes. `
        + "Wait for other tasks to finish, or raise runtime.sandbox.maxRunningContainers if the host has memory to spare."
      );
    }
    await sleep(pollIntervalMs, input.signal);
  }
}

export type SerialGate = <T>(callback: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

/**
 * Runs callbacks one at a time, so this process checks capacity and creates a container without racing itself.
 * A caller whose `signal` aborts while it is still queued leaves at once, and its callback never runs.
 */
export function createSerialGate(): SerialGate {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(callback: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    let entered = false;
    const enter = (): Promise<T> => {
      entered = true;
      throwIfAborted(signal);
      return callback();
    };
    const run = tail.then(enter, enter);
    tail = run.catch(() => undefined);
    if (!signal) return run;
    return new Promise<T>((resolve, reject) => {
      // Once the callback has started it owns the abort, so a container it creates is never orphaned.
      const onAbort = (): void => {
        if (!entered) reject(abortReason(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      void run.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  };
}

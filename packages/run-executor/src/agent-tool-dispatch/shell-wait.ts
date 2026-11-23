import type { ShellSessionWaitState } from "../agent/ports/platform-tools.js";

export const MAX_IN_RUN_WAIT_SECONDS = 3600;
// A wait tied to a shell session wakes when the job does, so it may run as long as a long job.
export const MAX_SHELL_CONDITION_WAIT_SECONDS = 6 * 3600;
const POLL_INTERVAL_MS = 1000;
// Each session read runs a command in the session's container, so a long wait backs off:
// once a second at first, then 1.5 times longer after each read, up to every 10 seconds.
const FAST_POLL_WINDOW_MS = 30_000;
const POLL_BACKOFF_FACTOR = 1.5;
const MAX_POLL_INTERVAL_MS = 10_000;

export function maxInRunWaitSeconds(hasShellConditions: boolean): number {
  return hasShellConditions ? MAX_SHELL_CONDITION_WAIT_SECONDS : MAX_IN_RUN_WAIT_SECONDS;
}

function nextShellPollIntervalMs(startedAtMs: number, previousMs: number): number {
  if (Date.now() - startedAtMs < FAST_POLL_WINDOW_MS) {
    return POLL_INTERVAL_MS;
  }
  return Math.min(MAX_POLL_INTERVAL_MS, Math.round(previousMs * POLL_BACKOFF_FACTOR));
}

export interface ShellWaitCondition {
  session_id: string;
  on_output: boolean;
  on_exit: boolean;
}

interface WaitInput {
  seconds: number;
  shellSessions: ShellWaitCondition[];
  readSession: (sessionId: string) => Promise<ShellSessionWaitState>;
  signal?: AbortSignal;
  assertNotCancelled: () => Promise<void>;
}

interface WaitResult {
  reason: "timeout" | "shell_output" | "shell_exit";
  elapsed_seconds: number;
  session: {
    session_id: string;
    status: string;
    command_id: string | null;
    exit_code: number | null;
    output: string;
    output_truncated: boolean;
  } | null;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function shellResult(reason: "shell_output" | "shell_exit", session: ShellSessionWaitState) {
  return {
    reason,
    session: {
      session_id: session.sessionId,
      status: session.status,
      command_id: session.commandId,
      exit_code: session.exitCode,
      output: session.output,
      output_truncated: session.outputTruncated
    }
  };
}

async function monitorShell(input: WaitInput, condition: ShellWaitCondition, signal: AbortSignal) {
  const startedAtMs = Date.now();
  let initialOutputVersion: string | null | undefined;
  let observed = false;
  let pollIntervalMs = POLL_INTERVAL_MS;
  while (true) {
    signal.throwIfAborted();
    const session = await input.readSession(condition.session_id);
    signal.throwIfAborted();
    if (condition.on_exit && session.exitCode !== null) {
      return shellResult("shell_exit", session);
    }
    if (condition.on_output && observed && session.outputVersion !== initialOutputVersion) {
      return shellResult("shell_output", session);
    }
    if (["stopped", "failed", "completed"].includes(session.status)) {
      const reason = session.stopReason ? `\nStop reason: ${session.stopReason}` : "";
      throw new Error(`Shell session ${condition.session_id} is ${session.status}; no further matching output or exit is available.${reason}`);
    }
    initialOutputVersion = session.outputVersion;
    observed = true;
    pollIntervalMs = nextShellPollIntervalMs(startedAtMs, pollIntervalMs);
    await delay(pollIntervalMs, signal);
  }
}

async function monitorCancellation(input: WaitInput, signal: AbortSignal): Promise<never> {
  while (true) {
    await delay(POLL_INTERVAL_MS, signal);
    await input.assertNotCancelled();
  }
}

export async function waitForConditions(input: WaitInput): Promise<WaitResult> {
  const maxSeconds = maxInRunWaitSeconds(input.shellSessions.length > 0);
  if (!Number.isInteger(input.seconds) || input.seconds < 1 || input.seconds > maxSeconds) {
    const scope = input.shellSessions.length > 0 ? "In-run waits on shell sessions" : "Time-only in-run waits";
    throw new Error(`${scope} take 1 to ${maxSeconds} seconds.`);
  }
  await input.assertNotCancelled();
  const startedAt = Date.now();
  const controller = new AbortController();
  const signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
  try {
    // Race the reads too: a slow session must not delay the timeout or another session's wake-up.
    const result = await Promise.race([
      delay(input.seconds * 1000, signal).then(() => ({ reason: "timeout" as const, session: null })),
      monitorCancellation(input, signal),
      ...input.shellSessions.map((condition) => monitorShell(input, condition, signal))
    ]);
    signal.throwIfAborted();
    return { ...result, elapsed_seconds: (Date.now() - startedAt) / 1000 };
  } finally {
    controller.abort();
  }
}

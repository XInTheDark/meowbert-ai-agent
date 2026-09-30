import {
  getPersistentShellSessionStatus,
  type PersistentShellSessionStatusResult
} from "./persistent-shell-sessions.js";

export const MAX_IN_RUN_WAIT_SECONDS = 3600;
const POLL_INTERVAL_MS = 1000;

export interface ShellWaitCondition {
  session_id: string;
  on_output: boolean;
  on_exit: boolean;
}

interface WaitInput {
  seconds: number;
  shellSessions: ShellWaitCondition[];
  environmentId: string;
  taskDir: string;
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

function shellResult(reason: "shell_output" | "shell_exit", session: PersistentShellSessionStatusResult) {
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
  let initialOutputVersion: string | null | undefined;
  let observed = false;
  while (true) {
    signal.throwIfAborted();
    const session = await getPersistentShellSessionStatus({
      sessionId: condition.session_id,
      environmentId: input.environmentId,
      taskDir: input.taskDir
    });
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
    await delay(POLL_INTERVAL_MS, signal);
  }
}

async function monitorCancellation(input: WaitInput, signal: AbortSignal): Promise<never> {
  while (true) {
    await delay(POLL_INTERVAL_MS, signal);
    await input.assertNotCancelled();
  }
}

export async function waitForConditions(input: WaitInput): Promise<WaitResult> {
  if (!Number.isInteger(input.seconds) || input.seconds < 1 || input.seconds > MAX_IN_RUN_WAIT_SECONDS) {
    throw new Error(`In-run wait seconds must be between 1 and ${MAX_IN_RUN_WAIT_SECONDS}.`);
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

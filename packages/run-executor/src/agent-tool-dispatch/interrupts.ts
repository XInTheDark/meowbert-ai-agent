import type { RunControl } from "../agent/ports/run-control.js";

const COMMAND_INTERRUPT_POLL_INTERVAL_MS = 1000;

export interface CommandInterruptMonitor {
  stop: () => void;
  wasInterrupted: () => boolean;
}

export function startCommandInterruptMonitor(input: {
  control: RunControl;
  step: number;
  onInterrupt: () => void;
}): CommandInterruptMonitor {
  let stopped = false;
  let pollInFlight = false;
  let pollTimer: NodeJS.Timeout | null = null;
  let interrupted = false;

  const schedulePoll = (): void => {
    if (stopped || interrupted) {
      return;
    }

    pollTimer = setTimeout(() => {
      void pollOnce();
    }, COMMAND_INTERRUPT_POLL_INTERVAL_MS);
  };

  const pollOnce = async (): Promise<void> => {
    if (stopped || interrupted || pollInFlight) {
      return;
    }

    pollInFlight = true;
    try {
      if (await input.control.consumeCommandInterrupt(input.step)) {
        interrupted = true;
        input.onInterrupt();
        return;
      }
    } catch {
      // Best-effort polling: keep command execution resilient if check fails.
    } finally {
      pollInFlight = false;
    }

    schedulePoll();
  };

  void pollOnce();

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    },
    wasInterrupted: () => interrupted
  };
}

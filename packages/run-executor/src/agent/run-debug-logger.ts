import type { RunControl } from "./ports/run-control.js";

export interface TaskDebugStageInput<T> {
  stage: string;
  startMessage: string;
  run: () => Promise<T>;
  startPayload?: Record<string, unknown>;
  successMessage?: string | ((result: T) => string);
  successPayload?: Record<string, unknown> | ((result: T) => Record<string, unknown>);
  failureMessage?: string | ((error: unknown) => string);
  failurePayload?: Record<string, unknown> | ((error: unknown) => Record<string, unknown>);
}

export interface TaskDebugLogger {
  log(message: string, payload?: Record<string, unknown>): Promise<void>;
  stage<T>(input: TaskDebugStageInput<T>): Promise<T>;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  const text = String(error ?? "Unknown error").trim();
  return text.length > 0 ? text : "Unknown error";
}

function resolveMessage<T>(
  value: string | ((input: T) => string) | undefined,
  fallback: string,
  input: T
): string {
  if (typeof value === "function") {
    return value(input);
  }

  return typeof value === "string" ? value : fallback;
}

function resolvePayload<T>(
  value: Record<string, unknown> | ((input: T) => Record<string, unknown>) | undefined,
  input: T
): Record<string, unknown> {
  if (typeof value === "function") {
    return value(input);
  }

  return value ?? {};
}

interface DebugLogSink {
  isEnabled: () => Promise<boolean>;
  emit: (message: string, payload: Record<string, unknown>) => Promise<void>;
}

// Startup and run stages logged as task events while the platform's debug mode is on.
export function createDebugLogger(sink: DebugLogSink): TaskDebugLogger {
  let enabledPromise: Promise<boolean> | null = null;

  const isEnabled = async (): Promise<boolean> => {
    enabledPromise ??= sink.isEnabled();
    return enabledPromise;
  };

  const log = async (message: string, payload: Record<string, unknown> = {}): Promise<void> => {
    if (!(await isEnabled())) {
      return;
    }

    await sink.emit(message, payload);
  };

  const stage = async <T>(input: TaskDebugStageInput<T>): Promise<T> => {
    const startedAtMs = Date.now();
    await log(input.startMessage, {
      stage: input.stage,
      phase: "start",
      ...(input.startPayload ?? {})
    });

    try {
      const result = await input.run();
      await log(
        resolveMessage(input.successMessage, `${input.startMessage} Done.`, result),
        {
          stage: input.stage,
          phase: "success",
          durationMs: Date.now() - startedAtMs,
          ...resolvePayload(input.successPayload, result)
        }
      );
      return result;
    } catch (error) {
      const message = toErrorMessage(error);
      await log(
        resolveMessage(input.failureMessage, `${input.stage} failed: ${message}`, error),
        {
          stage: input.stage,
          phase: "error",
          durationMs: Date.now() - startedAtMs,
          error: message,
          ...resolvePayload(input.failurePayload, error)
        }
      );
      throw error;
    }
  };

  return {
    log,
    stage
  };
}

export function createRunDebugLogger(control: RunControl): TaskDebugLogger {
  return createDebugLogger({
    isEnabled: () => control.isDebugEnabled(),
    emit: async (message, payload) => {
      try {
        await control.emitEvent("log", { message, ...payload });
      } catch (error) {
        console.warn("[task-debug] Failed to emit debug event", error);
      }
    }
  });
}

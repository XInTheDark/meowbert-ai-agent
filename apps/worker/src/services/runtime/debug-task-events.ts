import { query } from "../../lib/db.js";
import { emitTaskEvent } from "./events.js";

const DEBUG_MODE_CACHE_TTL_MS = 5_000;

interface DebugModeRow {
  debug_mode: boolean;
}

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

let cachedDebugMode: { value: boolean; expiresAtMs: number } | null = null;
let pendingDebugModeLoad: Promise<boolean> | null = null;

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

async function loadTaskDebugModeEnabled(): Promise<boolean> {
  try {
    const result = await query<DebugModeRow>(
      `SELECT debug_mode
         FROM platform_settings
        WHERE id = 1`
    );

    return result.rows[0]?.debug_mode === true;
  } catch (error) {
    console.warn("[task-debug] Failed to load debug mode setting", error);
    return false;
  }
}

export async function isTaskDebugModeEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cachedDebugMode && cachedDebugMode.expiresAtMs > now) {
    return cachedDebugMode.value;
  }

  if (!pendingDebugModeLoad) {
    pendingDebugModeLoad = loadTaskDebugModeEnabled()
      .then((value) => {
        cachedDebugMode = {
          value,
          expiresAtMs: Date.now() + DEBUG_MODE_CACHE_TTL_MS
        };
        return value;
      })
      .finally(() => {
        pendingDebugModeLoad = null;
      });
  }

  return pendingDebugModeLoad;
}

async function emitTaskDebugLogEvent(taskId: string, message: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await emitTaskEvent(taskId, "log", {
      message,
      ...payload
    });
  } catch (error) {
    console.warn(`[task-debug] Failed to emit debug event for ${taskId}`, error);
  }
}

export function createTaskDebugLogger(taskId: string): TaskDebugLogger {
  let enabledPromise: Promise<boolean> | null = null;

  const isEnabled = async (): Promise<boolean> => {
    enabledPromise ??= isTaskDebugModeEnabled();
    return enabledPromise;
  };

  const log = async (message: string, payload: Record<string, unknown> = {}): Promise<void> => {
    if (!(await isEnabled())) {
      return;
    }

    await emitTaskDebugLogEvent(taskId, message, payload);
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

export function resetTaskDebugModeCacheForTests(): void {
  cachedDebugMode = null;
  pendingDebugModeLoad = null;
}

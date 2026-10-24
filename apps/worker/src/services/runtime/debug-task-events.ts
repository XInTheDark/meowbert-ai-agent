import { query } from "../../lib/db.js";
import { emitTaskEvent } from "./events.js";
import { createDebugLogger, type TaskDebugLogger } from "@meowbert/run-executor/agent/run-debug-logger";

export type { TaskDebugLogger, TaskDebugStageInput } from "@meowbert/run-executor/agent/run-debug-logger";

const DEBUG_MODE_CACHE_TTL_MS = 5_000;

interface DebugModeRow {
  debug_mode: boolean;
}

let cachedDebugMode: { value: boolean; expiresAtMs: number } | null = null;
let pendingDebugModeLoad: Promise<boolean> | null = null;

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
  return createDebugLogger({
    isEnabled: isTaskDebugModeEnabled,
    emit: (message, payload) => emitTaskDebugLogEvent(taskId, message, payload)
  });
}

export function resetTaskDebugModeCacheForTests(): void {
  cachedDebugMode = null;
  pendingDebugModeLoad = null;
}

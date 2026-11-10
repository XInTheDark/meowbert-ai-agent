import type { PoolClient } from "pg";
import { resolveIdleCompactionForModel } from "@meowbert/shared";
import { withTransaction } from "../../lib/db.js";
import { enqueueSubagentRun } from "../subagents/dispatch.js";
import { resolveWakeRoute } from "../project-master/wake.js";
import { hasNewerWorkOrFreshContext, lockIdleCompactableTask } from "./idle-task.js";
import { loadLastModelRequest } from "./last-model-request.js";

// Compacts after most of the cache lifetime, leaving the rest for the compaction request to read it.
const IDLE_COMPACTION_CACHE_FRACTION = 0.8;
// Room for the request to run when an admin-set delay lands close to the end of the cache lifetime.
const IDLE_COMPACTION_DEADLINE_MARGIN_MS = 5 * 60_000;

// Past this, a compaction still waiting on retries gives up and leaves the next real run to carry it.
export function resolveIdleCompactionDeadlineMs(input: { startedAtMs: number; ttlMs: number; delayMs: number }): number {
  return input.startedAtMs + Math.max(input.ttlMs, input.delayMs + IDLE_COMPACTION_DEADLINE_MARGIN_MS);
}

export type IdleCompactionOutcome =
  | { kind: "compacting" }
  | { kind: "due_later"; delayMs: number }
  | { kind: "skipped" };

interface PlatformIdleSettings {
  modelMetadata: unknown;
  delaySeconds: number | null;
}

async function loadPlatformIdleSettings(client: PoolClient): Promise<PlatformIdleSettings> {
  const result = await client.query<{ model_metadata_json: unknown; idle_compaction_delay_seconds: number | null }>(
    "SELECT model_metadata_json, idle_compaction_delay_seconds FROM platform_settings WHERE id = 1"
  );
  const row = result.rows[0];
  return { modelMetadata: row?.model_metadata_json ?? null, delaySeconds: row?.idle_compaction_delay_seconds ?? null };
}

// Returns when the compaction is due, or null when this conversation should not be compacted.
// A cachebeat that kept the cache warm moves its lifetime to start at the latest beat.
async function resolveIdleCompactionDueAt(
  client: PoolClient,
  taskId: string,
  cacheReadAtMs: number | null
): Promise<{ dueAtMs: number; expiresAtMs: number; deadlineAtMs: number } | null> {
  if (await hasNewerWorkOrFreshContext(client, taskId)) return null;
  const last = await loadLastModelRequest(taskId, client);
  if (!last) return null;
  const platform = await loadPlatformIdleSettings(client);
  const settings = resolveIdleCompactionForModel(last.model, platform.modelMetadata);
  if (!settings.enabled || last.usedTokens < settings.minTokens) return null;
  const ttlMs = settings.promptCacheTtlSeconds * 1000;
  const readAtMs = Math.max(last.startedAtMs, cacheReadAtMs ?? 0);
  // An admin-set delay replaces the automatic one; a delay past the cache lifetime means no compaction.
  const delayMs = platform.delaySeconds === null ? ttlMs * IDLE_COMPACTION_CACHE_FRACTION : platform.delaySeconds * 1000;
  return {
    dueAtMs: last.startedAtMs + delayMs,
    expiresAtMs: readAtMs + ttlMs,
    deadlineAtMs: resolveIdleCompactionDeadlineMs({ startedAtMs: readAtMs, ttlMs, delayMs: Math.max(0, last.startedAtMs + delayMs - readAtMs) })
  };
}

// Once the cache has expired, compacting would pay full price for the whole conversation, so the
// next real run carries it instead. Runs only after any cachebeat for the task has finished.
export async function compactIdleTaskIfDue(taskId: string, cacheReadAtMs: number | null = null): Promise<IdleCompactionOutcome> {
  return withTransaction(async (client): Promise<IdleCompactionOutcome> => {
    const task = await lockIdleCompactableTask(client, taskId);
    if (!task) return { kind: "skipped" };
    const due = await resolveIdleCompactionDueAt(client, taskId, cacheReadAtMs);
    const now = Date.now();
    if (!due || now >= due.expiresAtMs) return { kind: "skipped" };
    if (now < due.dueAtMs) return { kind: "due_later", delayMs: due.dueAtMs - now };

    // The branch the latest run selected is the one whose cache is warm.
    const route = await resolveWakeRoute(client, taskId, task, null);
    await enqueueSubagentRun(client, {
      taskId,
      workspaceId: task.workspace_id,
      environmentId: task.environment_id,
      triggerSource: "web",
      mode: "compact_only",
      contextAction: "idle",
      idleCompactionDeadlineAt: new Date(due.deadlineAtMs).toISOString(),
      restoreStatus: task.status,
      selectionUserId: route.userId
    });
    return { kind: "compacting" };
  });
}

import type { PoolClient } from "pg";
import { resolveIdleCompactionForModel } from "@meowbert/shared";
import { withTransaction } from "../../lib/db.js";
import { enqueueSubagentRun } from "../subagents/dispatch.js";
import { resolveWakeRoute } from "../project-master/wake.js";
import { lockIdleCompactableTask } from "./idle-task.js";

// Compacts after most of the cache lifetime, leaving the rest for the compaction request to read it.
const IDLE_COMPACTION_CACHE_FRACTION = 0.8;

export type IdleCompactionOutcome =
  | { kind: "compacting" }
  | { kind: "due_later"; delayMs: number }
  | { kind: "skipped" };

interface LastModelRequest {
  startedAtMs: number;
  usedTokens: number;
  model: string;
}

// The provider-measured usage of the task's latest model request, which also says when it started.
async function loadLastModelRequest(client: PoolClient, taskId: string): Promise<LastModelRequest | null> {
  const result = await client.query<{ payload_json: Record<string, unknown> }>(
    `SELECT payload_json
       FROM task_events
      WHERE task_id = $1 AND type = 'context_usage' AND payload_json->>'source' = 'actual'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [taskId]
  );
  const payload = result.rows[0]?.payload_json;
  const startedAtMs = typeof payload?.requestStartedAt === "string" ? Date.parse(payload.requestStartedAt) : Number.NaN;
  if (!payload || !Number.isFinite(startedAtMs) || typeof payload.usedTokens !== "number" || typeof payload.model !== "string") {
    return null;
  }
  return { startedAtMs, usedTokens: payload.usedTokens, model: payload.model };
}

// A Master's pending reports start a real run soon, and a compaction run means the context was just cleared.
async function hasNewerWorkOrFreshContext(client: PoolClient, taskId: string): Promise<boolean> {
  const result = await client.query<{ blocked: boolean }>(
    `SELECT EXISTS (
              SELECT 1 FROM project_master_reports WHERE master_task_id = $1 AND delivered_at IS NULL
            )
            OR COALESCE((
              SELECT run_kind FROM task_runs WHERE task_id = $1 ORDER BY attempt_no DESC LIMIT 1
            ), '') = 'compact_only' AS blocked`,
    [taskId]
  );
  return result.rows[0]?.blocked === true;
}

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
async function resolveIdleCompactionDueAt(client: PoolClient, taskId: string): Promise<{ dueAtMs: number; expiresAtMs: number } | null> {
  if (await hasNewerWorkOrFreshContext(client, taskId)) return null;
  const last = await loadLastModelRequest(client, taskId);
  if (!last) return null;
  const platform = await loadPlatformIdleSettings(client);
  const settings = resolveIdleCompactionForModel(last.model, platform.modelMetadata);
  if (!settings.enabled || last.usedTokens < settings.minTokens) return null;
  const ttlMs = settings.promptCacheTtlSeconds * 1000;
  // An admin-set delay replaces the automatic one; a delay past the cache lifetime means no compaction.
  const delayMs = platform.delaySeconds === null ? ttlMs * IDLE_COMPACTION_CACHE_FRACTION : platform.delaySeconds * 1000;
  return {
    dueAtMs: last.startedAtMs + delayMs,
    expiresAtMs: last.startedAtMs + ttlMs
  };
}

// Once the cache has expired, compacting would pay full price for the whole conversation, so the
// next real run carries it instead.
export async function compactIdleTaskIfDue(taskId: string): Promise<IdleCompactionOutcome> {
  return withTransaction(async (client): Promise<IdleCompactionOutcome> => {
    const task = await lockIdleCompactableTask(client, taskId);
    if (!task) return { kind: "skipped" };
    const due = await resolveIdleCompactionDueAt(client, taskId);
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
      restoreStatus: task.status,
      selectionUserId: route.userId
    });
    return { kind: "compacting" };
  });
}

import type { PoolClient } from "pg";
import { resolveIdleCompactionForModel } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { enqueueSubagentRun } from "../subagents/dispatch.js";
import { lockIdleEnabledMaster, resolveWakeRoute } from "./wake.js";

// Compacts after most of the cache lifetime, leaving the rest for the compaction request to read it.
const IDLE_COMPACTION_CACHE_FRACTION = 0.8;
// How far back the sweep looks for Masters that went idle while no worker was listening.
const IDLE_SWEEP_LOOKBACK_HOURS = 24;

export type IdleCompactionOutcome =
  | { kind: "compacting" }
  | { kind: "due_later"; delayMs: number }
  | { kind: "skipped" };

interface LastModelRequest {
  startedAtMs: number;
  usedTokens: number;
  model: string;
}

// The provider-measured usage of the Master's latest model request, which also says when it started.
async function loadLastModelRequest(client: PoolClient, masterTaskId: string): Promise<LastModelRequest | null> {
  const result = await client.query<{ payload_json: Record<string, unknown> }>(
    `SELECT payload_json
       FROM task_events
      WHERE task_id = $1 AND type = 'context_usage' AND payload_json->>'source' = 'actual'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [masterTaskId]
  );
  const payload = result.rows[0]?.payload_json;
  const startedAtMs = typeof payload?.requestStartedAt === "string" ? Date.parse(payload.requestStartedAt) : Number.NaN;
  if (!payload || !Number.isFinite(startedAtMs) || typeof payload.usedTokens !== "number" || typeof payload.model !== "string") {
    return null;
  }
  return { startedAtMs, usedTokens: payload.usedTokens, model: payload.model };
}

// Pending reports start a real run soon, and a compaction run means the context was just cleared.
async function hasNewerWorkOrFreshContext(client: PoolClient, masterTaskId: string): Promise<boolean> {
  const result = await client.query<{ blocked: boolean }>(
    `SELECT EXISTS (
              SELECT 1 FROM project_master_reports WHERE master_task_id = $1 AND delivered_at IS NULL
            )
            OR COALESCE((
              SELECT run_kind FROM task_runs WHERE task_id = $1 ORDER BY attempt_no DESC LIMIT 1
            ), '') = 'compact_only' AS blocked`,
    [masterTaskId]
  );
  return result.rows[0]?.blocked === true;
}

async function loadModelMetadata(client: PoolClient): Promise<unknown> {
  const result = await client.query<{ model_metadata_json: unknown }>(
    "SELECT model_metadata_json FROM platform_settings WHERE id = 1"
  );
  return result.rows[0]?.model_metadata_json ?? null;
}

// Returns when the compaction is due, or null when this conversation should not be compacted.
async function resolveIdleCompactionDueAt(client: PoolClient, masterTaskId: string): Promise<{ dueAtMs: number; expiresAtMs: number } | null> {
  if (await hasNewerWorkOrFreshContext(client, masterTaskId)) return null;
  const last = await loadLastModelRequest(client, masterTaskId);
  if (!last) return null;
  const settings = resolveIdleCompactionForModel(last.model, await loadModelMetadata(client));
  if (!settings.enabled || last.usedTokens < settings.minTokens) return null;
  const ttlMs = settings.promptCacheTtlSeconds * 1000;
  return {
    dueAtMs: last.startedAtMs + ttlMs * IDLE_COMPACTION_CACHE_FRACTION,
    expiresAtMs: last.startedAtMs + ttlMs
  };
}

// Once the cache has expired, compacting would pay full price for the whole conversation, so the
// next real run carries it instead.
export async function compactIdleMasterIfDue(masterTaskId: string): Promise<IdleCompactionOutcome> {
  return withTransaction(async (client): Promise<IdleCompactionOutcome> => {
    const master = await lockIdleEnabledMaster(client, masterTaskId);
    if (!master) return { kind: "skipped" };
    const due = await resolveIdleCompactionDueAt(client, masterTaskId);
    const now = Date.now();
    if (!due || now >= due.expiresAtMs) return { kind: "skipped" };
    if (now < due.dueAtMs) return { kind: "due_later", delayMs: due.dueAtMs - now };

    // The branch the latest run selected is the one whose cache is warm.
    const route = await resolveWakeRoute(client, masterTaskId, master, null);
    await enqueueSubagentRun(client, {
      taskId: masterTaskId,
      workspaceId: master.workspace_id,
      environmentId: master.environment_id,
      triggerSource: "web",
      mode: "compact_only",
      contextAction: "idle",
      restoreStatus: master.status,
      selectionUserId: route.userId
    });
    return { kind: "compacting" };
  });
}

// Idle, enabled Masters that ran recently, for catching up after a restart or a missed notification.
export async function listRecentlyIdleMasters(limit: number): Promise<string[]> {
  const result = await query<{ task_id: string }>(
    `SELECT pm.task_id
       FROM project_masters pm
       JOIN tasks t ON t.id = pm.task_id
       LEFT JOIN workspace_settings ws ON ws.workspace_id = t.workspace_id
      WHERE t.trashed_at IS NULL
        AND t.status NOT IN ('queued', 'starting', 'running')
        AND COALESCE(ws.model_defaults_json->>'projectMasterEnabled', 'true') <> 'false'
        AND EXISTS (
          SELECT 1 FROM task_runs tr
           WHERE tr.task_id = pm.task_id AND tr.ended_at > now() - make_interval(hours => $2)
        )
      LIMIT $1`,
    [limit, IDLE_SWEEP_LOOKBACK_HOURS]
  );
  return result.rows.map((row) => row.task_id);
}

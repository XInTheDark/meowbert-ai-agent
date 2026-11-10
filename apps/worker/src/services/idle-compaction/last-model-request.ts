import type { PoolClient } from "pg";
import { query } from "../../lib/db.js";

export interface LastModelRequest {
  startedAtMs: number;
  usedTokens: number;
  model: string;
  // Hash of the request's prompt prefix; with the task id it names the provider session.
  prefixHash: string | null;
}

// The provider-measured usage of the task's latest model request, which also says when it started.
export async function loadLastModelRequest(taskId: string, client?: PoolClient): Promise<LastModelRequest | null> {
  const sql = `SELECT payload_json
                 FROM task_events
                WHERE task_id = $1 AND type = 'context_usage' AND payload_json->>'source' = 'actual'
                ORDER BY created_at DESC, id DESC
                LIMIT 1`;
  const result = client
    ? await client.query<{ payload_json: Record<string, unknown> }>(sql, [taskId])
    : await query<{ payload_json: Record<string, unknown> }>(sql, [taskId]);
  const payload = result.rows[0]?.payload_json;
  const startedAtMs = typeof payload?.requestStartedAt === "string" ? Date.parse(payload.requestStartedAt) : Number.NaN;
  if (!payload || !Number.isFinite(startedAtMs) || typeof payload.usedTokens !== "number" || typeof payload.model !== "string") {
    return null;
  }
  return {
    startedAtMs,
    usedTokens: payload.usedTokens,
    model: payload.model,
    prefixHash: typeof payload.prefixHash === "string" && payload.prefixHash.length > 0 ? payload.prefixHash : null
  };
}

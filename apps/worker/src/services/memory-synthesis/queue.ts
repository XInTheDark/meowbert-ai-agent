import { withTransaction } from "../../lib/db.js";

export interface SynthesisRequestRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  initiator_user_id: string | null;
  source_through_at: string | null;
}

// Lock the workspace before reading its running requests. The second statement gets a fresh
// snapshot after the lock, so concurrent workers cannot start refreshes in sibling Projects.
export async function claimNextMemorySynthesisRequest(input?: { workspaceId: string }): Promise<SynthesisRequestRow | null> {
  return withTransaction(async (client) => {
    const workspace = await client.query<{ id: string }>(
      `SELECT w.id FROM workspaces w
        WHERE w.file_host->>'kind' = 'server'
          AND ($1::uuid IS NULL OR w.id = $1)
          AND EXISTS (SELECT 1 FROM memory_synthesis_requests r WHERE r.workspace_id = w.id AND r.status = 'queued')
          AND NOT EXISTS (SELECT 1 FROM memory_synthesis_requests r WHERE r.workspace_id = w.id AND r.status = 'running')
        ORDER BY (SELECT MIN(created_at) FROM memory_synthesis_requests r WHERE r.workspace_id = w.id AND r.status = 'queued'), w.id
        LIMIT 1 FOR UPDATE OF w SKIP LOCKED`,
      [input?.workspaceId ?? null]
    );
    if (!workspace.rows[0]) return null;
    const result = await client.query<SynthesisRequestRow>(
      `SELECT id, workspace_id, environment_id, initiator_user_id, source_through_at
         FROM memory_synthesis_requests
        WHERE workspace_id = $1 AND status = 'queued'
          AND NOT EXISTS (SELECT 1 FROM memory_synthesis_requests running WHERE running.workspace_id = $1 AND running.status = 'running')
        ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [workspace.rows[0].id]
    );
    const request = result.rows[0];
    if (!request) return null;
    await client.query("UPDATE memory_synthesis_requests SET status = 'running', started_at = now(), updated_at = now() WHERE id = $1", [request.id]);
    return request;
  });
}

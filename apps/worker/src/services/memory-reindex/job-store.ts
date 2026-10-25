import { normalizeWorkspaceFileHost, workspaceFileFeatures } from "@meowbert/shared";
import { query } from "../../lib/db.js";

const STALE_JOB_HEARTBEAT = "5 minutes";
const MAX_RECORDED_ERRORS = 50;

export interface ClaimedReindexJob {
  id: string;
  concurrency: number;
}

export interface ReindexWorkspace {
  file_host?: unknown;
  id: string;
  name: string;
  root_path: string | null;
  storage_backend_id: string | null;
}

// Claims a queued job, or resumes a running one whose worker stopped heartbeating. Progress is
// reset on resume; workspaces already rebuilt for this generation sync as quick no-ops.
export async function claimReindexJob(): Promise<ClaimedReindexJob | null> {
  const result = await query<ClaimedReindexJob>(
    `UPDATE memory_reindex_jobs
        SET status = 'running',
            started_at = COALESCE(started_at, now()),
            heartbeat_at = now(),
            completed_workspaces = 0,
            failed_workspaces = 0,
            active_workspaces_json = '[]'::jsonb,
            errors_json = '[]'::jsonb,
            updated_at = now()
      WHERE id = (
        SELECT id
          FROM memory_reindex_jobs
         WHERE status = 'queued'
            OR (status = 'running' AND heartbeat_at < now() - interval '${STALE_JOB_HEARTBEAT}')
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, concurrency`
  );
  return result.rows[0] ?? null;
}

export async function listMemoryEnabledWorkspaces(): Promise<ReindexWorkspace[]> {
  const result = await query<ReindexWorkspace>(
    `SELECT w.id, w.name, w.root_path, w.storage_backend_id, w.file_host
       FROM workspaces w
       LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id
      WHERE COALESCE(ws.memory_enabled, true) = true
      ORDER BY w.created_at, w.id`
  );
  return result.rows.filter((workspace) => workspaceFileFeatures(normalizeWorkspaceFileHost(workspace.file_host)).memorySearch);
}

export async function setReindexTotal(jobId: string, total: number): Promise<void> {
  await query(
    `UPDATE memory_reindex_jobs SET total_workspaces = $2, heartbeat_at = now(), updated_at = now() WHERE id = $1`,
    [jobId, total]
  );
}

export async function touchReindexJob(jobId: string): Promise<void> {
  await query(
    `UPDATE memory_reindex_jobs SET heartbeat_at = now() WHERE id = $1 AND status = 'running'`,
    [jobId]
  );
}

// Returns false once the job is no longer running (cancelled from the admin panel).
export async function markWorkspaceStarted(jobId: string, workspaceName: string): Promise<boolean> {
  const result = await query(
    `UPDATE memory_reindex_jobs
        SET active_workspaces_json = active_workspaces_json || to_jsonb($2::text),
            heartbeat_at = now(),
            updated_at = now()
      WHERE id = $1 AND status = 'running'`,
    [jobId, workspaceName]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markWorkspaceFinished(jobId: string, workspaceName: string, error: string | null): Promise<void> {
  await query(
    `UPDATE memory_reindex_jobs
        SET active_workspaces_json = active_workspaces_json - $2::text,
            completed_workspaces = completed_workspaces + CASE WHEN $3::text IS NULL THEN 1 ELSE 0 END,
            failed_workspaces = failed_workspaces + CASE WHEN $3::text IS NULL THEN 0 ELSE 1 END,
            errors_json = CASE
              WHEN $3::text IS NULL OR jsonb_array_length(errors_json) >= $4 THEN errors_json
              ELSE errors_json || jsonb_build_array(jsonb_build_object('workspace', $2::text, 'message', $3::text))
            END,
            heartbeat_at = now(),
            updated_at = now()
      WHERE id = $1 AND status = 'running'`,
    [jobId, workspaceName, error, MAX_RECORDED_ERRORS]
  );
}

export async function finishReindexJob(jobId: string): Promise<void> {
  await query(
    `UPDATE memory_reindex_jobs
        SET status = CASE WHEN failed_workspaces > 0 THEN 'failed' ELSE 'succeeded' END,
            active_workspaces_json = '[]'::jsonb,
            finished_at = now(),
            updated_at = now()
      WHERE id = $1 AND status = 'running'`,
    [jobId]
  );
}

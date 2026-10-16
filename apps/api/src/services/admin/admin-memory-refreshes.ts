import { query } from "../../lib/db.js";

const RECENT_MEMORY_REFRESH_LIMIT = 10;

export interface AdminMemoryRefreshSummary {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  taskId: string | null;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  initiatorLabel: string | null;
  errorSummary: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface MemoryRefreshRow {
  id: string;
  status: AdminMemoryRefreshSummary["status"];
  task_id: string | null;
  workspace_id: string;
  workspace_name: string;
  environment_id: string;
  environment_name: string;
  initiator_label: string | null;
  error_summary: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export async function listRecentMemoryRefreshes(): Promise<AdminMemoryRefreshSummary[]> {
  const result = await query<MemoryRefreshRow>(
    `SELECT r.id,
            r.status,
            r.task_id,
            r.workspace_id,
            w.name AS workspace_name,
            r.environment_id,
            e.name AS environment_name,
            COALESCE(NULLIF(btrim(u.display_name), ''), u.email) AS initiator_label,
            r.error_summary,
            r.created_at,
            r.completed_at
       FROM memory_synthesis_requests r
       JOIN workspaces w ON w.id = r.workspace_id
       JOIN environments e ON e.id = r.environment_id
       LEFT JOIN users u ON u.id = r.initiator_user_id
      ORDER BY r.created_at DESC
      LIMIT $1`,
    [RECENT_MEMORY_REFRESH_LIMIT]
  );

  return result.rows.map((row) => ({
    id: row.id,
    status: row.status,
    taskId: row.task_id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    projectId: row.environment_id,
    projectName: row.environment_name,
    initiatorLabel: row.initiator_label,
    errorSummary: row.error_summary,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null
  }));
}

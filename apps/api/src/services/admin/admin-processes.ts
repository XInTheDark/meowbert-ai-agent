import { query } from "../../lib/db.js";

const ACTIVE_PROCESS_STATUSES = ["queued", "starting", "running"] as const;

interface AdminProcessRow {
  task_id: string;
  task_title: string | null;
  task_status: typeof ACTIVE_PROCESS_STATUSES[number];
  task_source: string;
  workflow_type: string | null;
  created_at: string;
  updated_at: string;
  workspace_id: string;
  workspace_name: string;
  project_id: string;
  project_name: string;
  initiator_user_id: string | null;
  initiator_email: string | null;
  initiator_display_name: string | null;
  run_id: string | null;
  run_attempt_no: number | null;
  run_kind: string | null;
  run_started_at: string | null;
  worker_id: string | null;
  dispatch_queue_state: string | null;
  dispatch_class: string | null;
  dispatch_queued_at: string | null;
  dispatch_started_at: string | null;
}

export interface AdminTaskProcessSummary {
  taskId: string;
  taskTitle: string | null;
  taskStatus: typeof ACTIVE_PROCESS_STATUSES[number];
  taskSource: string;
  workflowType: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  initiatorUserId: string | null;
  initiatorEmail: string | null;
  initiatorDisplayName: string | null;
  runId: string | null;
  runAttemptNo: number | null;
  runKind: string | null;
  runStartedAt: string | null;
  workerId: string | null;
  dispatchQueueState: string | null;
  dispatchClass: string | null;
  dispatchQueuedAt: string | null;
  dispatchStartedAt: string | null;
}

export interface AdminProcessOverview {
  totalCount: number;
  queuedCount: number;
  startingCount: number;
  runningCount: number;
  processes: AdminTaskProcessSummary[];
}

function countProcessesByStatus(
  processes: AdminTaskProcessSummary[],
  status: AdminTaskProcessSummary["taskStatus"]
): number {
  return processes.filter((process) => process.taskStatus === status).length;
}

function mapAdminProcessRow(row: AdminProcessRow): AdminTaskProcessSummary {
  return {
    taskId: row.task_id,
    taskTitle: row.task_title,
    taskStatus: row.task_status,
    taskSource: row.task_source,
    workflowType: row.workflow_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    projectId: row.project_id,
    projectName: row.project_name,
    initiatorUserId: row.initiator_user_id,
    initiatorEmail: row.initiator_email,
    initiatorDisplayName: row.initiator_display_name,
    runId: row.run_id,
    runAttemptNo: row.run_attempt_no,
    runKind: row.run_kind,
    runStartedAt: row.run_started_at,
    workerId: row.worker_id,
    dispatchQueueState: row.dispatch_queue_state,
    dispatchClass: row.dispatch_class,
    dispatchQueuedAt: row.dispatch_queued_at,
    dispatchStartedAt: row.dispatch_started_at
  };
}

export async function listAdminProcesses(): Promise<AdminProcessOverview> {
  const result = await query<AdminProcessRow>(
    `SELECT
        t.id AS task_id,
        t.title AS task_title,
        t.status AS task_status,
        t.source AS task_source,
        t.workflow_type,
        t.created_at::text,
        t.updated_at::text,
        w.id AS workspace_id,
        w.name AS workspace_name,
        p.id AS project_id,
        p.name AS project_name,
        u.id AS initiator_user_id,
        u.email AS initiator_email,
        u.display_name AS initiator_display_name,
        active_run.id AS run_id,
        active_run.attempt_no AS run_attempt_no,
        active_run.run_kind,
        active_run.started_at::text AS run_started_at,
        active_run.worker_id,
        d.queue_state AS dispatch_queue_state,
        d.dispatch_class,
        d.queued_at::text AS dispatch_queued_at,
        d.started_at::text AS dispatch_started_at
       FROM tasks t
       JOIN workspaces w
         ON w.id = t.workspace_id
       JOIN environments p
         ON p.id = t.environment_id
       LEFT JOIN users u
         ON u.id = t.initiator_user_id
       LEFT JOIN LATERAL (
         SELECT tr.id,
                tr.attempt_no,
                tr.run_kind,
                tr.started_at,
                tr.worker_id
           FROM task_runs tr
          WHERE tr.task_id = t.id
            AND tr.ended_at IS NULL
          ORDER BY tr.attempt_no DESC, tr.id DESC
          LIMIT 1
       ) AS active_run
         ON true
       LEFT JOIN task_run_dispatches d
         ON d.run_id = active_run.id
      WHERE t.status = ANY($1::text[])
        AND t.trashed_at IS NULL
      ORDER BY CASE t.status
                 WHEN 'running' THEN 0
                 WHEN 'starting' THEN 1
                 ELSE 2
               END ASC,
               COALESCE(active_run.started_at, d.queued_at, t.updated_at) ASC,
               t.created_at ASC,
               t.id ASC
      LIMIT 500`,
    [ACTIVE_PROCESS_STATUSES]
  );

  const processes = result.rows.map(mapAdminProcessRow);

  return {
    totalCount: processes.length,
    queuedCount: countProcessesByStatus(processes, "queued"),
    startingCount: countProcessesByStatus(processes, "starting"),
    runningCount: countProcessesByStatus(processes, "running"),
    processes
  };
}

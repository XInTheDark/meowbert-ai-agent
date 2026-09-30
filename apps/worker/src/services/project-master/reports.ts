import type { PoolClient } from "pg";
import { loadTaskOutputFiles } from "../agent-db/task-output-files.js";

const REPORT_EXCERPT_CHARS = 2_000;
const MAX_REPORTS_PER_DELIVERY = 20;

export interface PendingMasterReport {
  id: string;
  task_id: string;
  status: string;
  title: string | null;
  latest_response: string | null;
  error_summary: string | null;
  output_files: string[];
}

export function formatMasterReport(report: PendingMasterReport): string {
  const title = report.title?.trim() || "Untitled task";
  const outcome = report.status === "awaiting_input" ? "is waiting for input" : `finished: ${report.status}`;
  const details = report.status === "failed" || report.status === "cancelled"
    ? report.error_summary?.trim()
    : report.latest_response?.trim();
  const excerpt = details && details.length > REPORT_EXCERPT_CHARS
    ? `${details.slice(0, REPORT_EXCERPT_CHARS)}\n[truncated; use view_task_history for the rest]`
    : details;
  const files = report.output_files.length > 0
    ? `Files (relative to the project root): ${report.output_files.join(", ")}`
    : null;
  return [`[Task report] "${title}" (${report.task_id}) ${outcome}`, excerpt, files].filter(Boolean).join("\n");
}

// The caller holds the Master's task row lock so concurrent deliveries cannot duplicate reports.
export async function claimPendingMasterReports(client: PoolClient, masterTaskId: string): Promise<PendingMasterReport[]> {
  const result = await client.query<Omit<PendingMasterReport, "output_files">>(
    `SELECT r.id,
            r.task_id,
            r.status,
            t.title,
            latest_message.text AS latest_response,
            tr.error_summary
       FROM project_master_reports r
       JOIN tasks t ON t.id = r.task_id
       LEFT JOIN task_runs tr ON tr.id = r.run_id
       LEFT JOIN LATERAL (
         SELECT tm.content_json->>'text' AS text
           FROM task_messages tm
          WHERE tm.task_id = r.task_id
            AND tm.role = 'assistant'
            AND COALESCE(tm.content_json->>'text', '') <> ''
          ORDER BY tm.created_at DESC, tm.id DESC
          LIMIT 1
       ) latest_message ON true
      WHERE r.master_task_id = $1
        AND r.delivered_at IS NULL
      ORDER BY r.created_at, r.id
      LIMIT $2`,
    [masterTaskId, MAX_REPORTS_PER_DELIVERY]
  );
  if (result.rows.length > 0) {
    await client.query(
      "UPDATE project_master_reports SET delivered_at = now() WHERE id = ANY($1::uuid[])",
      [result.rows.map((row) => row.id)]
    );
  }
  return Promise.all(result.rows.map(async (row) => ({
    ...row,
    output_files: await loadTaskOutputFiles(client, row.task_id)
  })));
}

import type { ArchiveTaskHistoryResult } from "@meowbert/shared";
import { query } from "../../lib/db.js";

export type TaskHistoryArchiveTriggerSource = "scheduled" | "manual";

interface ArchiveRunIdRow {
  id: string;
}

function formatArchiveRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 1_000 ? `${message.slice(0, 997)}...` : message;
}

export async function createScheduledArchiveRun(taskId: string): Promise<string> {
  const result = await query<ArchiveRunIdRow>(
    `INSERT INTO task_history_archive_runs (
       task_id,
       trigger_source,
       status,
       started_at
     ) VALUES ($1, 'scheduled', 'running', now())
     RETURNING id`,
    [taskId]
  );
  const runId = result.rows[0]?.id;
  if (!runId) {
    throw new Error("Failed to create task history archive activity.");
  }
  return runId;
}

export async function claimNextManualArchiveRun(): Promise<string | null> {
  const result = await query<ArchiveRunIdRow>(
    `WITH next_run AS (
       SELECT id
         FROM task_history_archive_runs
        WHERE status = 'queued'
          AND trigger_source = 'manual'
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE task_history_archive_runs run
        SET status = 'running',
            started_at = now(),
            error_summary = NULL
       FROM next_run
      WHERE run.id = next_run.id
     RETURNING run.id`
  );
  return result.rows[0]?.id ?? null;
}

export async function attachTaskToArchiveRun(runId: string, taskId: string): Promise<void> {
  await query(
    `UPDATE task_history_archive_runs
        SET task_id = $2
      WHERE id = $1
        AND status = 'running'`,
    [runId, taskId]
  );
}

export async function completeArchiveRun(
  runId: string,
  result: ArchiveTaskHistoryResult
): Promise<void> {
  const metrics = result.metrics;
  await query(
    `UPDATE task_history_archive_runs
        SET status = $2,
            archive_key = $3,
            original_size_bytes = $4,
            compressed_size_bytes = $5,
            message_count = $6,
            event_count = $7,
            revision_count = $8,
            workflow_message_count = $9,
            error_summary = $10,
            completed_at = now()
      WHERE id = $1`,
    [
      runId,
      result.status === "archived" ? "completed" : "skipped",
      result.archiveKey ?? null,
      metrics?.originalSizeBytes ?? null,
      metrics?.compressedSizeBytes ?? null,
      metrics?.messageCount ?? null,
      metrics?.eventCount ?? null,
      metrics?.revisionCount ?? null,
      metrics?.workflowMessageCount ?? null,
      result.status === "archived" ? null : result.reason ?? "Archive was skipped."
    ]
  );
}

export async function skipArchiveRun(runId: string, reason: string): Promise<void> {
  await query(
    `UPDATE task_history_archive_runs
        SET status = 'skipped',
            error_summary = $2,
            completed_at = now()
      WHERE id = $1`,
    [runId, reason]
  );
}

export async function failArchiveRun(runId: string, error: unknown): Promise<void> {
  await query(
    `UPDATE task_history_archive_runs
        SET status = 'failed',
            error_summary = $2,
            completed_at = now()
      WHERE id = $1`,
    [runId, formatArchiveRunError(error)]
  );
}

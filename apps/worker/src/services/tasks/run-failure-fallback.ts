import { createTaskMessageMetadata } from "@meowbert/shared";
import type { TaskStatus } from "@meowbert/shared";
import { withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";

interface FinalizeUnhandledRunFailureInput {
  taskId: string;
  runId: string;
  error: unknown;
}

interface FinalizeUnhandledRunFailureResult {
  finalized: boolean;
  taskMarkedFailed: boolean;
}

const FALLBACK_FAILURE_ELIGIBLE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "queued",
  "starting",
  "running",
  "awaiting_input"
]);

function toFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  const text = String(error ?? "Unknown worker error").trim();
  return text.length > 0 ? text : "Unknown worker error";
}

export async function finalizeUnhandledRunFailure(
  input: FinalizeUnhandledRunFailureInput
): Promise<FinalizeUnhandledRunFailureResult> {
  const errorMessage = toFailureMessage(input.error);
  const failureText = `Task failed: ${errorMessage}`;

  const txResult = await withTransaction(async (client) => {
    const runRes = await client.query<{ task_id: string; ended_at: string | null }>(
      `SELECT task_id, ended_at
         FROM task_runs
        WHERE id = $1
        FOR UPDATE`,
      [input.runId]
    );
    if ((runRes.rowCount ?? 0) === 0) {
      return { finalized: false, taskMarkedFailed: false };
    }

    const run = runRes.rows[0];
    if (run.task_id !== input.taskId || run.ended_at !== null) {
      return { finalized: false, taskMarkedFailed: false };
    }

    const taskRes = await client.query<{ status: TaskStatus }>(
      `SELECT status
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [input.taskId]
    );
    if ((taskRes.rowCount ?? 0) === 0) {
      await client.query(
        `UPDATE task_runs
            SET ended_at = now(),
                exit_reason = 'error',
                error_summary = $2
          WHERE id = $1`,
        [input.runId, errorMessage]
      );
      return { finalized: true, taskMarkedFailed: false };
    }

    const latestOpenRunRes = await client.query<{ id: string }>(
      `SELECT id
         FROM task_runs
        WHERE task_id = $1
          AND ended_at IS NULL
        ORDER BY attempt_no DESC
        LIMIT 1`,
      [input.taskId]
    );
    const latestOpenRunId = latestOpenRunRes.rows[0]?.id ?? null;
    const isLatestOpenRun = latestOpenRunId === input.runId;

    await client.query(
      `UPDATE task_runs
          SET ended_at = now(),
              exit_reason = 'error',
              error_summary = $2
        WHERE id = $1`,
      [input.runId, errorMessage]
    );

    if (!isLatestOpenRun) {
      return { finalized: true, taskMarkedFailed: false };
    }

    const currentTaskStatus = taskRes.rows[0].status;
    const shouldMarkTaskFailed = FALLBACK_FAILURE_ELIGIBLE_TASK_STATUSES.has(currentTaskStatus);
    if (!shouldMarkTaskFailed) {
      return { finalized: true, taskMarkedFailed: false };
    }

    await client.query(
      `UPDATE tasks
          SET status = 'failed',
              completed_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [input.taskId]
    );

    const latestLeafRes = await client.query<{ id: string }>(
      `SELECT tm.id
         FROM task_messages tm
        WHERE tm.task_id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM task_messages child
             WHERE child.task_id = tm.task_id
               AND child.parent_message_id = tm.id
          )
        ORDER BY tm.created_at DESC, tm.id DESC
        LIMIT 1`,
      [input.taskId]
    );
    const parentMessageId = latestLeafRes.rows[0]?.id ?? null;

    const createdAt = new Date().toISOString();
    await client.query(
      `INSERT INTO task_messages (
        task_id,
        role,
        content_json,
        message_metadata_json,
        parent_message_id,
        created_at
      )
      VALUES ($1, 'assistant', $2::jsonb, $3::jsonb, $4, $5)`,
      [
        input.taskId,
        JSON.stringify({ text: failureText }),
        JSON.stringify(createTaskMessageMetadata(createdAt)),
        parentMessageId,
        createdAt
      ]
    );

    return { finalized: true, taskMarkedFailed: true };
  });

  if (!txResult.finalized) {
    return txResult;
  }

  if (txResult.taskMarkedFailed) {
    await emitTaskEvent(input.taskId, "status", { status: "failed" });
    await emitTaskEvent(input.taskId, "error", {
      message: errorMessage,
      runId: input.runId,
      source: "worker_failed_fallback"
    });
  }

  return txResult;
}

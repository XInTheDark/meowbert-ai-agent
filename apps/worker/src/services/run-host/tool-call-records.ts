import { query } from "../../lib/db.js";
import type { RunToolCallStart } from "@meowbert/run-executor/agent/ports/run-control";

// Arguments are kept only to tell the agent which call was interrupted.
const MAX_RECORDED_ARGUMENT_CHARS = 4_000;

export async function recordToolCallStarted(taskId: string, runId: string, call: RunToolCallStart): Promise<void> {
  await query(
    `INSERT INTO task_run_tool_calls (run_id, call_id, task_id, name, arguments)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (run_id, call_id) DO NOTHING`,
    [runId, call.callId, taskId, call.name, call.arguments.slice(0, MAX_RECORDED_ARGUMENT_CHARS)]
  );
}

export async function recordToolCallFinished(runId: string, callId: string): Promise<void> {
  await query("DELETE FROM task_run_tool_calls WHERE run_id = $1 AND call_id = $2", [runId, callId]);
}

// Calls started by earlier runs of the task that never recorded a result.
export async function listUnfinishedToolCalls(taskId: string, currentRunId: string): Promise<RunToolCallStart[]> {
  const result = await query<{ call_id: string; name: string; arguments: string }>(
    `SELECT call_id, name, arguments
       FROM task_run_tool_calls
      WHERE task_id = $1 AND run_id <> $2
      ORDER BY started_at ASC`,
    [taskId, currentRunId]
  );
  return result.rows.map((row) => ({ callId: row.call_id, name: row.name, arguments: row.arguments }));
}

export async function clearInterruptedToolCalls(taskId: string, currentRunId: string, callIds: string[]): Promise<void> {
  if (callIds.length === 0) return;
  await query(
    "DELETE FROM task_run_tool_calls WHERE task_id = $1 AND run_id <> $2 AND call_id = ANY($3::text[])",
    [taskId, currentRunId, callIds]
  );
}

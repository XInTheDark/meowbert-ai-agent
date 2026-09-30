import { query } from "../../lib/db.js";
import type { ToolDispatchContext } from "../agent-tool-dispatch/types.js";
import { createRecurringTaskFromTool } from "../task-schedules/service.js";

export interface ScheduledManagedTask {
  taskId: string;
  repeat: string | null;
  timezone: string;
  nextRunAt: string | null;
}

async function loadExistingSchedule(taskId: string): Promise<ScheduledManagedTask | null> {
  const result = await query<{ repeat_cron: string | null; timezone: string; next_run_at: string | null }>(
    "SELECT repeat_cron, timezone, next_run_at FROM task_schedules WHERE task_id = $1",
    [taskId]
  );
  const row = result.rows[0];
  return row ? { taskId, repeat: row.repeat_cron, timezone: row.timezone, nextRunAt: row.next_run_at } : null;
}

// A scheduled task the Master starts belongs to the user like any other task, and reports to the
// Master after every run so the Master can pass the result on.
export async function createScheduledManagedTask(
  ctx: ToolDispatchContext,
  input: { taskId: string; title: string | null; message: string; repeat: string; timezone: string | null; listen: boolean }
): Promise<ScheduledManagedTask & { reusedExisting: boolean }> {
  const existing = await loadExistingSchedule(input.taskId);
  if (existing) {
    return { ...existing, reusedExisting: true };
  }

  const created = await createRecurringTaskFromTool({
    parentTaskId: ctx.taskId,
    taskId: input.taskId,
    title: input.title,
    initiatorUserId: ctx.actorUserId,
    reportToMasterTaskId: input.listen ? ctx.taskId : null,
    workspaceId: ctx.workspaceId,
    environmentId: ctx.environmentId,
    source: "web",
    connectorContextId: null,
    defaultTimezone: ctx.defaultTimezone,
    currentToolOptions: ctx.runToolOptions,
    message: input.message,
    mode: "scheduled",
    repeat: input.repeat,
    timezone: input.timezone,
    enabledTools: null
  });
  return { taskId: created.taskId, repeat: created.repeat, timezone: created.timezone, nextRunAt: created.nextRunAt, reusedExisting: false };
}

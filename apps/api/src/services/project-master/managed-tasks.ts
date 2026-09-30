import { query } from "../../lib/db.js";
import { cancelTaskAndSchedules } from "../tasks/task-cancellation.js";
import { ensureTaskHistoryWarm } from "../tasks/task-history.js";
import {
  appendTaskUserMessageAndEnqueue,
  createTaskWithInitialMessage,
  type TaskMessageToolOptions
} from "../tasks/task-service/index.js";
import { ProjectMasterError, type ProjectMasterTask } from "./master-task.js";

async function requireManagedTarget(master: ProjectMasterTask, targetTaskId: string): Promise<void> {
  if (targetTaskId === master.taskId) {
    throw new ProjectMasterError("The Master cannot target itself.", 400);
  }

  const result = await query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE id = $1
        AND environment_id = $2
        AND parent_task_id IS NULL
        AND workflow_parent_task_id IS NULL
        AND trashed_at IS NULL
        AND is_hidden = false
        AND is_incognito = false`,
    [targetTaskId, master.environmentId]
  );
  if (!result.rows[0]) {
    throw new ProjectMasterError("Task not found in this project.", 404);
  }
}

async function loadMasterTimezone(masterTaskId: string): Promise<string> {
  const result = await query<{ default_timezone: string }>(
    "SELECT default_timezone FROM tasks WHERE id = $1",
    [masterTaskId]
  );
  return result.rows[0]?.default_timezone ?? "UTC";
}

// A caller-supplied task id makes retried tool calls reuse the same task.
export async function createManagedTask(input: {
  master: ProjectMasterTask;
  userId: string;
  taskId: string;
  title: string | null;
  message: string;
  tools?: TaskMessageToolOptions;
}): Promise<{ taskId: string; reusedExisting: boolean }> {
  const created = await createTaskWithInitialMessage({
    taskId: input.taskId,
    workspaceId: input.master.workspaceId,
    environmentId: input.master.environmentId,
    source: "web",
    initiatorUserId: input.userId,
    title: input.title ?? undefined,
    message: input.message,
    sender: "project_master",
    tools: input.tools,
    defaultTimezone: await loadMasterTimezone(input.master.taskId)
  });
  return { taskId: created.taskId, reusedExisting: created.reusedExisting };
}

export async function messageManagedTask(input: {
  master: ProjectMasterTask;
  userId: string;
  taskId: string;
  message: string;
}): Promise<{ mode: "enqueued" | "interrupting" }> {
  await requireManagedTarget(input.master, input.taskId);
  await ensureTaskHistoryWarm(input.taskId);
  const run = await appendTaskUserMessageAndEnqueue({
    taskId: input.taskId,
    workspaceId: input.master.workspaceId,
    environmentId: input.master.environmentId,
    triggerSource: "web",
    message: input.message,
    sender: "project_master",
    userId: input.userId,
    interruptQueued: true
  });
  return { mode: run.mode };
}

export async function cancelManagedTask(input: { master: ProjectMasterTask; taskId: string }): Promise<void> {
  await requireManagedTarget(input.master, input.taskId);
  await cancelTaskAndSchedules(input.taskId);
}

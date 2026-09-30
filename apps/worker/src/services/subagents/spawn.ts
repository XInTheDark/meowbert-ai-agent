import { randomUUID } from "node:crypto";
import { createTaskMessageMetadata } from "@meowbert/shared";
import { withTransaction } from "../../lib/db.js";
import { loadSubagentTask } from "./access.js";
import { enqueueSubagentRun } from "./dispatch.js";
import type { SpawnSubagentInput, SubagentTask } from "./types.js";

export async function spawnSubagent(input: SpawnSubagentInput): Promise<SubagentTask> {
  return withTransaction(async (client) => {
    await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [input.taskId]);
    const parent = await loadSubagentTask(input.taskId, client);
    if (parent.workspace_id !== input.workspaceId || parent.environment_id !== input.environmentId) {
      throw new Error("Parent task does not belong to this project.");
    }
    if (parent.cancellation_requested) throw new Error("TASK_CANCELLED");
    const existing = await client.query<{ task_id: string }>(
      "SELECT task_id FROM task_subagent_sessions WHERE spawn_key = $1", [input.spawnKey]
    );
    if (existing.rows[0]) return loadSubagentTask(existing.rows[0].task_id, client);
    if (parent.subtask_depth >= 2) throw new Error("Maximum subagent depth is 2.");
    const taskId = randomUUID();
    const rootPath = `${parent.task_root_path.replace(/\/+$/, "")}/subtasks/${taskId}`;
    await client.query(
      `INSERT INTO tasks(id, workspace_id, environment_id, title, status, source, initiator_user_id,
        parent_task_id, subtask_depth, task_root_path, default_timezone)
       VALUES ($1, $2, $3, $4, 'awaiting_input', 'web', $5, $6, $7, $8, $9)`,
      [taskId, parent.workspace_id, parent.environment_id, input.title, parent.initiator_user_id,
        parent.id, parent.subtask_depth + 1, rootPath, parent.default_timezone]
    );
    await client.query(
      `INSERT INTO task_subagent_sessions(task_id, root_task_id, spawn_key, model_tier, runtime_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [taskId, parent.root_task_id, input.spawnKey, input.model, JSON.stringify(input.runtime)]
    );
    await client.query(
      `INSERT INTO task_messages(task_id, role, content_json, message_metadata_json, author_user_id)
       VALUES ($1, 'user', $2::jsonb, $3::jsonb, $4)`,
      [taskId, JSON.stringify({ text: input.message, tools: input.tools }),
        JSON.stringify(createTaskMessageMetadata(new Date().toISOString())), parent.initiator_user_id]
    );
    if (input.start !== false) await enqueueSubagentRun(client, {
      taskId, workspaceId: parent.workspace_id, environmentId: parent.environment_id,
      triggerSource: "web", mode: "default", selectionUserId: parent.initiator_user_id ?? undefined
    });
    return loadSubagentTask(taskId, client);
  });
}

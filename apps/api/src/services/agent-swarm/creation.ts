import { randomUUID } from "node:crypto";
import type { AgentSwarmSettings } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { setTaskBranchSelection } from "../tasks/task-service/index.js";
import { activateTaskTimeLimitInTx } from "../tasks/task-service/time-limit.js";
import { upsertAgentSwarmInTx } from "./swarm-row.js";
import {
  ensureWorkflowInitialRun,
  insertTaskWithInitialUserMessage,
  isTaskPrimaryKeyConflict,
  type BaseCreateWorkflowInput
} from "../tasks/task-workflows.js";

async function findExistingSwarmTask(
  taskId: string,
  input: BaseCreateWorkflowInput
): Promise<{ taskId: string; userMessageId: string } | null> {
  const existing = await query<{ task_id: string; user_message_id: string | null }>(
    `SELECT t.id AS task_id,
            (SELECT tm.id FROM task_messages tm
              WHERE tm.task_id = t.id AND tm.role = 'user'
              ORDER BY tm.created_at ASC, tm.id ASC LIMIT 1) AS user_message_id
       FROM tasks t
       JOIN task_swarms s ON s.task_id = t.id
      WHERE t.id = $1
        AND t.workspace_id = $2
        AND t.environment_id = $3
        AND t.source = 'web'
        AND t.initiator_user_id = $4`,
    [taskId, input.workspaceId, input.environmentId, input.initiatorUserId]
  );
  const row = existing.rows[0];
  return row?.user_message_id ? { taskId: row.task_id, userMessageId: row.user_message_id } : null;
}

// Creates the leader task, its first message and the swarm row together, then starts the leader.
// No lanes exist until the leader splits.
export async function createAgentSwarmTask(input: BaseCreateWorkflowInput & {
  settings: AgentSwarmSettings;
}): Promise<{ taskId: string; runId: string; userMessageId: string; reusedExisting: boolean }> {
  const taskId = input.taskId ?? randomUUID();
  const startLeader = async (userMessageId: string, reusedExisting: boolean) => {
    const run = await ensureWorkflowInitialRun({
      taskId,
      userMessageId,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      initiatorUserId: input.initiatorUserId,
      mode: "agent_swarm_leader",
      toolOptionsOverride: input.tools
    });
    return { taskId, runId: run.runId, userMessageId, reusedExisting };
  };

  const existingBeforeCreate = input.taskId ? await findExistingSwarmTask(taskId, input) : null;
  if (existingBeforeCreate) {
    return startLeader(existingBeforeCreate.userMessageId, true);
  }

  let userMessageId: string;
  try {
    userMessageId = await withTransaction(async (client) => {
      const leader = await insertTaskWithInitialUserMessage(client, {
        ...input,
        taskId,
        workflowType: "agent_swarm"
      });
      await setTaskBranchSelection({
        taskId,
        userId: input.initiatorUserId,
        activeLeafMessageId: leader.userMessageId,
        client
      });
      await upsertAgentSwarmInTx(client, taskId, input.settings);
      if (input.timeLimitSeconds !== null && input.timeLimitSeconds !== undefined) {
        await activateTaskTimeLimitInTx(client, taskId, leader.userMessageCreatedAt);
      }
      return leader.userMessageId;
    });
  } catch (error) {
    if (!input.taskId || !isTaskPrimaryKeyConflict(error)) {
      throw error;
    }
    const existing = await findExistingSwarmTask(taskId, input);
    if (!existing) {
      throw error;
    }
    return startLeader(existing.userMessageId, true);
  }

  return startLeader(userMessageId, false);
}

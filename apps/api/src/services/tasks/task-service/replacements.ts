import type { TaskExecutionJob, TaskSource } from "@meowbert/shared";
import { createTaskMessageMetadata } from "@meowbert/shared";
import { touchTaskHistoryActivity } from "@meowbert/shared";
import { withTransaction } from "../../../lib/db.js";
import { setTaskBranchSelection } from "./branching.js";
import { decideTaskDispatchModeInTx, resolveUserTriggeredRunModeInTx } from "./dispatch.js";
import { enqueueRun } from "./runs.js";
import { activateTaskTimeLimitInTx } from "./time-limit.js";
import { applySelectedSwarmInTx, resolveSelectedSwarm } from "./swarm-selection.js";

export async function replaceTaskMessageAndEnqueue(input: {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  triggerSource: TaskSource;
  sourceMessageId: string;
  parentMessageId: string | null;
  oldContent: Record<string, unknown>;
  nextContent: Record<string, unknown>;
  userId: string;
  interruptQueued?: boolean;
}): Promise<
  | { taskId: string; mode: "enqueued"; runId: string; attemptNo: number; messageId: string; activeLeafMessageId: string }
  | { taskId: string; mode: "interrupting"; messageId: string; activeLeafMessageId: string }
> {
  const selectedAgent = input.nextContent.agent;
  const selectedSwarm = await resolveSelectedSwarm(
    input.userId,
    selectedAgent && typeof selectedAgent === "object" && !Array.isArray(selectedAgent)
      && typeof (selectedAgent as { id?: unknown }).id === "string"
      ? (selectedAgent as { id: string }).id
      : undefined
  );
  const decision = await withTransaction(async (client) => {
    const createdAt = new Date().toISOString();
    const nextPayload = JSON.stringify(input.nextContent);
    const insertedMessage = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO task_messages (
        task_id,
        role,
        content_json,
        message_metadata_json,
        author_user_id,
        parent_message_id,
        edited_from_message_id,
        created_at
      )
      VALUES ($1, 'user', $2::jsonb, $3::jsonb, $4, $5, $6, $7)
      RETURNING id, created_at`,
      [
        input.taskId,
        nextPayload,
        JSON.stringify(createTaskMessageMetadata(createdAt)),
        input.userId,
        input.parentMessageId,
        input.sourceMessageId,
        createdAt
      ]
    );
    const nextMessageId = insertedMessage.rows[0].id;
    await touchTaskHistoryActivity(client, input.taskId, insertedMessage.rows[0].created_at);

    if (selectedSwarm) {
      await applySelectedSwarmInTx(client, {
        taskId: input.taskId,
        userId: input.userId,
        selectedSwarm,
        prompt: typeof input.nextContent.text === "string" ? input.nextContent.text : ""
      });
    }

    await activateTaskTimeLimitInTx(client, input.taskId, insertedMessage.rows[0].created_at);

    await client.query(
      `INSERT INTO task_message_revisions (
        task_id,
        message_id,
        edited_by_user_id,
        old_content_json,
        new_content_json
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [input.taskId, input.sourceMessageId, input.userId, JSON.stringify(input.oldContent), nextPayload]
    );

    await setTaskBranchSelection({
      taskId: input.taskId,
      userId: input.userId,
      activeLeafMessageId: nextMessageId,
      client
    });

    const runMode = await resolveUserTriggeredRunModeInTx(client, input.taskId);
    const mode = await decideTaskDispatchModeInTx(client, input.taskId, {
      interruptQueued: input.interruptQueued
    });

    return {
      mode,
      messageId: nextMessageId,
      runMode
    };
  });

  if (decision.mode === "interrupting") {
    return {
      taskId: input.taskId,
      mode: decision.mode,
      messageId: decision.messageId,
      activeLeafMessageId: decision.messageId
    };
  }

  const run = await enqueueRun({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: input.triggerSource,
    mode: decision.runMode as NonNullable<TaskExecutionJob["mode"]>,
    branchMessageId: decision.messageId,
    selectionUserId: input.userId,
    priorityActorUserId: input.userId,
    dispatchCategory: "followup"
  });

  return {
    taskId: input.taskId,
    mode: "enqueued",
    runId: run.runId,
    attemptNo: run.attemptNo,
    messageId: decision.messageId,
    activeLeafMessageId: decision.messageId
  };
}

import type { ChosenModelRoute, TaskSource } from "@meowbert/shared";
import { createTaskMessageMetadata } from "@meowbert/shared";
import { touchTaskHistoryActivity } from "@meowbert/shared";
import { withTransaction } from "../../../lib/db.js";
import { resolveActiveLeafMessageIdInTx, setTaskBranchSelection } from "./branching.js";
import { decideTaskDispatchModeInTx, resolveUserTriggeredRunModeInTx } from "./dispatch.js";
import { enqueueRun } from "./runs.js";
import { ensureTaskPromptEntitlement, recordTaskPromptUsage } from "./prompt-usage.js";
import { activateTaskTimeLimitInTx } from "./time-limit.js";
import { publishMemorySynthesisEvent } from "../../workspaces/memory-synthesis-events.js";
import { applySelectedSwarmPresetInTx, resolveSelectedSwarmPreset } from "../../agent-swarm/preset-selection.js";
import type { ProjectCanvasIntent } from "../../canvases/project-canvases.js";
import { applyFollowUpTaskSettingsInTx } from "./follow-up-settings.js";
import {
  buildUserMessageContent,
  type TaskMessageAttachment,
  type TaskMessageAgentSelection,
  type TaskMessageSender,
  type TaskMessageTaskAgentSelection,
  type TaskMessageToolOptions
} from "./shared.js";

export async function appendTaskUserMessageAndEnqueue(input: {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  triggerSource: TaskSource;
  message: string;
  sender?: TaskMessageSender;
  attachments?: TaskMessageAttachment[];
  tools?: TaskMessageToolOptions;
  agent?: TaskMessageAgentSelection;
  modelRoute?: ChosenModelRoute | null;
  taskAgent?: TaskMessageTaskAgentSelection | null;
  userId?: string;
  parentMessageId?: string | null;
  editedFromMessageId?: string | null;
  interruptQueued?: boolean;
  interactiveCanvasId?: string | null;
  interactiveCanvasIntent?: ProjectCanvasIntent | null;
  // Where the task's replies go from now on. Omit to leave it alone; null clears it (web replies only).
  connectorContextId?: string | null;
}): Promise<
  | { taskId: string; mode: "enqueued"; runId: string; attemptNo: number; messageId: string; activeLeafMessageId: string }
  | { taskId: string; mode: "interrupting"; messageId: string; activeLeafMessageId: string }
> {
  const entitlement = await ensureTaskPromptEntitlement({
    source: input.triggerSource,
    userId: input.userId ?? null
  });
  const selectedSwarmPreset = await resolveSelectedSwarmPreset(input.userId, input.agent?.id);
  const followUpDecision = await withTransaction(async (client) => {
    const resolvedParentMessageId =
      input.parentMessageId !== undefined
        ? input.parentMessageId
        : await resolveActiveLeafMessageIdInTx(client, input.taskId, input.userId);
    const createdAt = new Date().toISOString();

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
        JSON.stringify(
          buildUserMessageContent({
            message: input.message,
            sender: input.sender,
            attachments: input.attachments,
            tools: input.tools,
            agent: input.agent,
            modelRoute: input.modelRoute,
            taskAgent: input.taskAgent
          })
        ),
        JSON.stringify(createTaskMessageMetadata(createdAt)),
        input.userId ?? null,
        resolvedParentMessageId,
        input.editedFromMessageId ?? null,
        createdAt
      ]
    );
    const messageId = insertedMessage.rows[0].id;
    await touchTaskHistoryActivity(client, input.taskId, insertedMessage.rows[0].created_at);

    if (selectedSwarmPreset) {
      await applySelectedSwarmPresetInTx(client, { taskId: input.taskId, preset: selectedSwarmPreset });
    }

    await activateTaskTimeLimitInTx(client, input.taskId, insertedMessage.rows[0].created_at);

    await applyFollowUpTaskSettingsInTx(client, input);

    if (input.userId) {
      await setTaskBranchSelection({
        taskId: input.taskId,
        userId: input.userId,
        activeLeafMessageId: messageId,
        client
      });
    }

    const runMode = await resolveUserTriggeredRunModeInTx(client, input.taskId);
    const mode = await decideTaskDispatchModeInTx(client, input.taskId, {
      interruptQueued: input.interruptQueued
    });
    return {
      mode,
      messageId,
      runMode
    };
  });
  await recordTaskPromptUsage({
    entitlement,
    userId: input.userId ?? null,
    taskId: input.taskId,
    taskMessageId: followUpDecision.messageId
  });

  if (followUpDecision.mode === "interrupting") {
    await publishMemorySynthesisEvent({ workspaceId: input.workspaceId, environmentId: input.environmentId });
    return {
      taskId: input.taskId,
      mode: "interrupting",
      messageId: followUpDecision.messageId,
      activeLeafMessageId: followUpDecision.messageId
    };
  }

  const run = await enqueueRun({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: input.triggerSource,
    mode: followUpDecision.runMode,
    branchMessageId: followUpDecision.messageId,
    selectionUserId: input.userId,
    priorityActorUserId: input.userId,
    dispatchCategory: "followup"
  });
  await publishMemorySynthesisEvent({ workspaceId: input.workspaceId, environmentId: input.environmentId });

  return {
    taskId: input.taskId,
    mode: "enqueued",
    runId: run.runId,
    attemptNo: run.attemptNo,
    messageId: followUpDecision.messageId,
    activeLeafMessageId: followUpDecision.messageId
  };
}

export async function enqueueTaskFromBranch(input: {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  triggerSource: TaskSource;
  branchMessageId: string;
  selectionUserId?: string;
  interruptQueued?: boolean;
}): Promise<
  | { taskId: string; mode: "enqueued"; runId: string; attemptNo: number; activeLeafMessageId: string }
  | { taskId: string; mode: "interrupting"; activeLeafMessageId: string }
> {
  const mode = await withTransaction(async (client) => {
    const runMode = await resolveUserTriggeredRunModeInTx(client, input.taskId);
    if (input.selectionUserId) {
      await setTaskBranchSelection({
        taskId: input.taskId,
        userId: input.selectionUserId,
        activeLeafMessageId: input.branchMessageId,
        client
      });
    }
    const dispatchMode = await decideTaskDispatchModeInTx(client, input.taskId, {
      interruptQueued: input.interruptQueued
    });
    return {
      dispatchMode,
      runMode
    };
  });

  if (mode.dispatchMode === "interrupting") {
    return {
      taskId: input.taskId,
      mode: mode.dispatchMode,
      activeLeafMessageId: input.branchMessageId
    };
  }

  const run = await enqueueRun({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: input.triggerSource,
    mode: mode.runMode,
    branchMessageId: input.branchMessageId,
    selectionUserId: input.selectionUserId,
    priorityActorUserId: input.selectionUserId,
    dispatchCategory: "followup"
  });

  return {
    taskId: input.taskId,
    mode: mode.dispatchMode,
    runId: run.runId,
    attemptNo: run.attemptNo,
    activeLeafMessageId: input.branchMessageId
  };
}

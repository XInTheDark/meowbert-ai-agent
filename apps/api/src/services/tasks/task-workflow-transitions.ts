import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  createTaskMessageMetadata,
  normalizeAgentSwarmSettings,
  type TaskWorkflowType
} from "@meowbert/shared";
import type { z } from "zod";
import type { taskWorkflowPatchSchema } from "../../routes/tasks/shared.js";
import { deleteTaskTreesInTx, type TaskCleanupCandidateResult } from "./task-cleanup.js";
import { enableAgentSwarmOnTaskInTx } from "../agent-swarm/swarm-row.js";
import { assertNotLegacyAgentSwarmTaskInTx } from "../agent-swarm/legacy.js";
import { resolveAgentSwarmSettings } from "../agent-swarm/settings.js";

type TaskWorkflowPatchInput = NonNullable<z.infer<typeof taskWorkflowPatchSchema>>;

interface LockedTaskContext {
  id: string;
  workspace_id: string;
  environment_id: string;
  default_timezone: string;
  allow_waiting: boolean;
  workflow_type: TaskWorkflowType | null;
  title?: string | null;
}

const LONG_HORIZON_REVIEWER_COUNT = 1;

export class TaskTypeTransitionConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("Stop the task before changing its type.");
    this.name = "TaskTypeTransitionConflictError";
  }
}

function buildTaskRootPath(taskId: string): string {
  return `.meowbert/task-runs/${taskId}`;
}

function emptyTaskCleanupCandidates(): TaskCleanupCandidateResult {
  return { taskIds: [], taskRootPaths: [], workspacePaths: [], archiveKeys: [] };
}

export async function assertTaskTypeTransitionIdleInTx(client: PoolClient, taskId: string): Promise<void> {
  const activeRes = await client.query<{ id: string }>(
    `WITH RECURSIVE task_scope AS (
       SELECT id
         FROM tasks
        WHERE id = $1
       UNION
       SELECT child.id
         FROM tasks child
         JOIN task_scope parent
           ON child.parent_task_id = parent.id
           OR child.workflow_parent_task_id = parent.id
      )
      SELECT id
        FROM tasks
       WHERE id IN (SELECT id FROM task_scope)
         AND status IN ('starting', 'running')
      UNION ALL
      SELECT tr.task_id AS id
        FROM task_runs tr
       WHERE tr.task_id IN (SELECT id FROM task_scope)
         AND tr.ended_at IS NULL
      LIMIT 1`,
    [taskId]
  );

  if ((activeRes.rowCount ?? 0) > 0) {
    throw new TaskTypeTransitionConflictError();
  }
}

export async function clearTaskWorkflowInTx(
  client: PoolClient,
  taskId: string
): Promise<TaskCleanupCandidateResult> {
  const childRes = await client.query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE workflow_parent_task_id = $1
      FOR UPDATE`,
    [taskId]
  );

  await client.query(
    `UPDATE tasks
        SET status = 'cancelled',
            cancellation_requested = true,
            resume_after_interrupt = false,
            completed_at = COALESCE(completed_at, now()),
            updated_at = now()
      WHERE workflow_parent_task_id = $1
        AND status IN ('queued', 'starting', 'running', 'awaiting_input')`,
    [taskId]
  );

  const deletedChildren = await deleteTaskTreesInTx(client, childRes.rows.map((row) => row.id));
  await client.query(`DELETE FROM task_workflows WHERE task_id = $1`, [taskId]);
  await client.query(`DELETE FROM task_swarms WHERE task_id = $1`, [taskId]);

  await client.query(
    `UPDATE tasks
        SET workflow_type = NULL,
            workflow_internal_role = NULL,
            updated_at = now()
      WHERE id = $1`,
    [taskId]
  );

  return deletedChildren;
}

async function loadTaskInitialUserPrompt(client: PoolClient, taskId: string, fallbackTitle?: string | null): Promise<string> {
  const messageRes = await client.query<{ content_json: { text?: string } }>(
    `SELECT content_json
       FROM task_messages
      WHERE task_id = $1
        AND role = 'user'
      ORDER BY created_at ASC
      LIMIT 1`,
    [taskId]
  );

  return messageRes.rows[0]?.content_json?.text?.trim()
    || fallbackTitle?.trim()
    || "Execute the assigned task workflow.";
}

async function insertWorkflowRow(
  client: PoolClient,
  input: {
    taskId: string;
    workflowType: TaskWorkflowType;
    phase: string;
    config: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO task_workflows (task_id, workflow_type, phase, config_json, state_json)
     VALUES ($1, $2, $3, $4::jsonb, '{}'::jsonb)`,
    [input.taskId, input.workflowType, input.phase, JSON.stringify(input.config)]
  );
}

async function insertWorkflowAgent(
  client: PoolClient,
  input: {
    workflowTaskId: string;
    role: "main" | "reviewer" | "leader" | "worker";
    slotIndex: number;
    taskId: string;
    state?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO task_workflow_agents (workflow_task_id, role, slot_index, task_id, state_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [input.workflowTaskId, input.role, input.slotIndex, input.taskId, JSON.stringify(input.state ?? {})]
  );

  return { id: result.rows[0].id };
}

async function insertSystemChildTask(
  client: PoolClient,
  input: {
    taskId: string;
    parentTaskId: string;
    workspaceId: string;
    environmentId: string;
    initiatorUserId: string;
    title: string;
    message: string;
    defaultTimezone: string;
    allowWaiting: boolean;
    workflowType: TaskWorkflowType;
    workflowInternalRole: "reviewer";
  }
): Promise<void> {
  const createdAt = new Date().toISOString();
  await client.query(
    `INSERT INTO tasks (
      id, workspace_id, environment_id, title, status, source,
      initiator_user_id, default_timezone, allow_waiting,
      task_root_path, workflow_type, workflow_parent_task_id, workflow_internal_role
    ) VALUES ($1, $2, $3, $4, 'queued', 'web', $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.taskId,
      input.workspaceId,
      input.environmentId,
      input.title,
      input.initiatorUserId,
      input.defaultTimezone,
      input.allowWaiting,
      buildTaskRootPath(input.taskId),
      input.workflowType,
      input.parentTaskId,
      input.workflowInternalRole
    ]
  );

  await client.query(
    `INSERT INTO task_messages (task_id, role, content_json, message_metadata_json, created_at)
     VALUES ($1, 'system', $2::jsonb, $3::jsonb, $4)`,
    [
      input.taskId,
      JSON.stringify({ text: input.message }),
      JSON.stringify(createTaskMessageMetadata(createdAt)),
      createdAt
    ]
  );
}

function buildLongHorizonReviewerBootstrapMessage(userMessage: string): string {
  return [
    "You are the independent reviewer for this Long Horizon task.",
    "The primary agent is executing the following task:",
    "",
    userMessage.trim(),
    "",
    "Review their plan and submissions when requested using the review tools."
  ].join("\n");
}

async function transitionToLongHorizonInTx(
  client: PoolClient,
  task: LockedTaskContext,
  userId: string,
  workflow: TaskWorkflowPatchInput
): Promise<TaskCleanupCandidateResult> {
  const enableClarifyPhase = workflow.enableClarifyPhase !== false;
  const enableReviewPhase = workflow.enableReviewPhase !== false;
  const reviewerCount = enableReviewPhase ? LONG_HORIZON_REVIEWER_COUNT : 0;
  const config = {
    reviewerCount,
    tokenBudget: workflow.tokenBudget ?? null,
    timeBudgetMinutes: workflow.timeBudgetMinutes ?? null,
    enableClarifyPhase,
    enableReviewPhase,
    reviewMode: workflow.type === "quality_control" ? "quality_control" : "standard",
    researchMode: workflow.type === "deep_research" ? "deep_research" : "standard"
  };

  if (task.workflow_type === "long_horizon") {
    const cleanup = await reconcileLongHorizonReviewersInTx(client, {
      task,
      userId,
      desiredReviewerCount: reviewerCount
    });
    await client.query(
      `UPDATE task_workflows
          SET config_json = config_json || $2::jsonb,
              updated_at = now()
        WHERE task_id = $1`,
      [task.id, JSON.stringify(config)]
    );
    return cleanup;
  }

  const cleanup = await clearTaskWorkflowInTx(client, task.id);
  await client.query(
    `UPDATE tasks
        SET workflow_type = 'long_horizon',
            workflow_internal_role = NULL,
            updated_at = now()
      WHERE id = $1`,
    [task.id]
  );

  await insertWorkflowRow(client, {
    taskId: task.id,
    workflowType: "long_horizon",
    phase: enableClarifyPhase ? "clarify" : "working",
    config
  });

  await insertWorkflowAgent(client, {
    workflowTaskId: task.id,
    role: "main",
    slotIndex: 0,
    taskId: task.id
  });

  const prompt = await loadTaskInitialUserPrompt(client, task.id, task.title);
  await addLongHorizonReviewersInTx(client, {
    task,
    userId,
    prompt,
    reviewerSlots: Array.from({ length: reviewerCount }, (_, index) => index)
  });

  return cleanup;
}

interface ExistingLongHorizonReviewer {
  agentId: string;
  taskId: string;
  slotIndex: number;
}

async function loadExistingLongHorizonReviewers(
  client: PoolClient,
  workflowTaskId: string
): Promise<ExistingLongHorizonReviewer[]> {
  const reviewersRes = await client.query<ExistingLongHorizonReviewer>(
    `SELECT a.id AS "agentId",
            a.task_id AS "taskId",
            a.slot_index AS "slotIndex"
       FROM task_workflow_agents a
      WHERE a.workflow_task_id = $1
        AND a.role = 'reviewer'
      ORDER BY a.slot_index ASC, a.task_id ASC
      FOR UPDATE`,
    [workflowTaskId]
  );

  return reviewersRes.rows;
}

async function addLongHorizonReviewersInTx(
  client: PoolClient,
  input: {
    task: LockedTaskContext;
    userId: string;
    prompt: string;
    reviewerSlots: number[];
  }
): Promise<void> {
  for (const index of input.reviewerSlots) {
    const reviewerTaskId = randomUUID();
    await insertSystemChildTask(client, {
      taskId: reviewerTaskId,
      parentTaskId: input.task.id,
      workspaceId: input.task.workspace_id,
      environmentId: input.task.environment_id,
      initiatorUserId: input.userId,
      title: `${input.task.title?.trim() || "Long Horizon Task"} · Reviewer ${index + 1}`,
      message: buildLongHorizonReviewerBootstrapMessage(input.prompt),
      defaultTimezone: input.task.default_timezone,
      allowWaiting: false,
      workflowType: "long_horizon",
      workflowInternalRole: "reviewer"
    });

    await insertWorkflowAgent(client, {
      workflowTaskId: input.task.id,
      role: "reviewer",
      slotIndex: index,
      taskId: reviewerTaskId
    });
  }
}

async function cancelTaskRowsInTx(client: PoolClient, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) {
    return;
  }

  await client.query(
    `UPDATE tasks
        SET status = CASE
              WHEN status IN ('queued', 'starting', 'running', 'awaiting_input') THEN 'cancelled'
              ELSE status
            END,
            cancellation_requested = CASE
              WHEN status IN ('queued', 'starting', 'running', 'awaiting_input') THEN true
              ELSE cancellation_requested
            END,
            resume_after_interrupt = CASE
              WHEN status IN ('queued', 'starting', 'running', 'awaiting_input') THEN false
              ELSE resume_after_interrupt
            END,
            completed_at = CASE
              WHEN status IN ('queued', 'starting', 'running', 'awaiting_input') THEN COALESCE(completed_at, now())
              ELSE completed_at
            END,
            updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [taskIds]
  );
}

async function reconcileLongHorizonReviewersInTx(
  client: PoolClient,
  input: {
    task: LockedTaskContext;
    userId: string;
    desiredReviewerCount: number;
  }
): Promise<TaskCleanupCandidateResult> {
  const existingReviewers = await loadExistingLongHorizonReviewers(client, input.task.id);
  const reviewersToRemove = existingReviewers.slice(input.desiredReviewerCount);
  await cancelTaskRowsInTx(client, reviewersToRemove.map((reviewer) => reviewer.taskId));
  const cleanup = await deleteTaskTreesInTx(client, reviewersToRemove.map((reviewer) => reviewer.taskId));
  const retainedReviewers = existingReviewers.slice(0, input.desiredReviewerCount);
  const retainedSlots = new Set(retainedReviewers.map((reviewer) => reviewer.slotIndex));

  for (const [index, reviewer] of retainedReviewers.entries()) {
    if (reviewer.slotIndex === index) {
      continue;
    }
    await client.query(
      `UPDATE task_workflow_agents
          SET slot_index = $2,
              updated_at = now()
        WHERE id = $1`,
      [reviewer.agentId, index]
    );
    retainedSlots.delete(reviewer.slotIndex);
    retainedSlots.add(index);
  }

  const missingReviewerCount = input.desiredReviewerCount - retainedReviewers.length;
  if (missingReviewerCount <= 0) {
    return cleanup;
  }

  const prompt = await loadTaskInitialUserPrompt(client, input.task.id, input.task.title);
  const missingSlots = Array.from({ length: input.desiredReviewerCount }, (_, index) => index)
    .filter((index) => !retainedSlots.has(index));
  await addLongHorizonReviewersInTx(client, {
    task: input.task,
    userId: input.userId,
    prompt,
    reviewerSlots: missingSlots
  });

  return cleanup;
}

// A swarm task needs only its swarm row; lanes are created by the leader as it works. Changing the
// settings of an existing swarm keeps whatever the request leaves out.
async function transitionToAgentSwarmInTx(
  client: PoolClient,
  task: LockedTaskContext,
  workflow: TaskWorkflowPatchInput
): Promise<TaskCleanupCandidateResult> {
  let existing = null;
  if (task.workflow_type === "agent_swarm") {
    await assertNotLegacyAgentSwarmTaskInTx(client, task.id);
    const existingRes = await client.query<{ config_json: unknown }>(
      "SELECT config_json FROM task_swarms WHERE task_id = $1",
      [task.id]
    );
    existing = normalizeAgentSwarmSettings(existingRes.rows[0]?.config_json);
  }
  const cleanup = task.workflow_type === "long_horizon"
    ? await clearTaskWorkflowInTx(client, task.id)
    : emptyTaskCleanupCandidates();
  await enableAgentSwarmOnTaskInTx(client, task.id, resolveAgentSwarmSettings(workflow, existing));
  return cleanup;
}

export async function applyWorkflowTransitionInTx(
  client: PoolClient,
  input: {
    taskId: string;
    userId: string;
    task: LockedTaskContext;
    workflow: TaskWorkflowPatchInput;
  }
): Promise<TaskCleanupCandidateResult> {
  if (input.workflow.type === "standard") {
    return clearTaskWorkflowInTx(client, input.taskId);
  }

  if (
    input.workflow.type === "long_horizon"
    || input.workflow.type === "deep_research"
    || input.workflow.type === "quality_control"
  ) {
    return transitionToLongHorizonInTx(client, input.task, input.userId, input.workflow);
  }

  if (input.workflow.type === "agent_swarm") {
    return transitionToAgentSwarmInTx(client, input.task, input.workflow);
  }

  return emptyTaskCleanupCandidates();
}

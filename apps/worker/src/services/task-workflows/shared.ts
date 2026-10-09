import { randomUUID } from "node:crypto";
import {
  clampAgentSwarmReviewRounds,
  buildTaskRunQueueJobId,
  type TaskExecutionJob
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";

export const SWARM_INBOX_TOKEN_BUDGET = 32_000;
export const SWARM_INBOX_CHAR_BUDGET = SWARM_INBOX_TOKEN_BUDGET * 4;
export const SWARM_LEADER_WAKE_DELAY_MS = 300_000;
export const SWARM_READ_CHANNEL_MESSAGE_LIMIT = 200;

export type WorkflowAgentRole = "main" | "reviewer" | "leader" | "worker";
export type LongHorizonPhase = "clarify" | "working" | "reviewing" | "approved" | "completed";
export type AgentSwarmPhase = "active" | "completed";

export interface WorkflowAgentRecord {
  id: string;
  role: WorkflowAgentRole;
  slot_index: number;
  task_id: string;
  title: string | null;
  status: string;
  task_root_path: string;
  last_inbox_refresh_message_no: number;
  state_json: Record<string, unknown>;
}

export interface WorkflowMessageRecord {
  id: string;
  channel_id: string;
  channel_title: string | null;
  channel_kind: "global" | "direct" | "group";
  message_no: number;
  content_markdown: string;
  created_at: string;
  sender_task_id: string | null;
  sender_role: WorkflowAgentRole | null;
  sender_slot_index: number | null;
  sender_title: string | null;
}

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function clampNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}

export function coerceNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function estimateTextCost(value: string): number {
  return value.length;
}

export function formatSwarmAgentLabel(
  role: WorkflowAgentRole | null,
  slotIndex: number | null,
  fallback?: string | null
): string {
  if (role === "leader") {
    return "Leader";
  }

  if (role === "worker" && typeof slotIndex === "number") {
    return `Worker ${slotIndex + 1}`;
  }

  if (role === "reviewer" && typeof slotIndex === "number") {
    return `Reviewer ${slotIndex + 1}`;
  }

  if (role === "main") {
    return "Main";
  }

  return coerceNullableString(fallback) ?? "Unknown";
}

export function isSwarmTaskActiveStatus(status: string): boolean {
  return status === "queued" || status === "starting" || status === "running" || status === "awaiting_input";
}

export function resolveAgentSwarmReviewRounds(context: LoadedWorkflowRunContext | null): number {
  return context?.workflowType === "agent_swarm"
    ? clampAgentSwarmReviewRounds(context.config.reviewRounds)
    : 0;
}

export function getSwarmToolOptionsOverride(context: LoadedWorkflowRunContext): TaskExecutionJob["toolOptionsOverride"] | undefined {
  if (context.workflowType !== "agent_swarm") {
    return undefined;
  }

  const selectedTools = context.config.selectedTools;
  if (typeof selectedTools !== "object" || selectedTools === null || Array.isArray(selectedTools)) {
    return undefined;
  }

  const raw = selectedTools as Record<string, unknown>;
  const enabledSkills = Array.isArray(raw.enabledSkills)
    ? raw.enabledSkills.filter((skill): skill is string => typeof skill === "string")
    : undefined;
  const enabledSources = Array.isArray(raw.enabledSources)
    ? raw.enabledSources.filter((source): source is string => typeof source === "string")
    : undefined;

  return {
    webSearch: raw.webSearch === true,
    memorySearch: raw.memorySearch === true,
    scheduleTask: raw.scheduleTask === true,
    subtasks: raw.subtasks === true,
    computerUse: raw.computerUse === true,
    enabledSkills,
    enabledSources
  };
}

export async function enqueueWorkflowTaskRun(input: {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  triggerSource: TaskExecutionJob["triggerSource"];
  mode: TaskExecutionJob["mode"];
  branchMessageId?: string | null;
  selectionUserId?: string | null;
  toolOptionsOverride?: TaskExecutionJob["toolOptionsOverride"];
  delayMs?: number;
}): Promise<{ runId: string; attemptNo: number }> {
  const runId = randomUUID();
  const jobId = buildTaskRunQueueJobId(input.taskId, runId);

  const attemptNo = await withTransaction(async (client) => {
    const taskLockRes = await client.query<{ id: string }>(
      `SELECT id
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [input.taskId]
    );
    if ((taskLockRes.rowCount ?? 0) === 0) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    const attemptRes = await client.query<{ attempt_no: number }>(
      `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
         FROM task_runs
        WHERE task_id = $1`,
      [input.taskId]
    );
    const nextAttemptNo = attemptRes.rows[0].attempt_no;

    await client.query(
      `INSERT INTO task_runs (id, task_id, attempt_no, run_kind)
       VALUES ($1, $2, $3, $4)`,
      [runId, input.taskId, nextAttemptNo, input.mode ?? "default"]
    );

    await client.query(
      `UPDATE tasks
          SET status = 'queued',
              cancellation_requested = false,
              resume_after_interrupt = false,
              completed_at = NULL,
              trashed_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [input.taskId]
    );

    return nextAttemptNo;
  });

  await taskQueue.add(
    jobId,
    {
      taskId: input.taskId,
      runId,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      triggerSource: input.triggerSource,
      mode: input.mode,
      branchMessageId: input.branchMessageId ?? undefined,
      selectionUserId: input.selectionUserId ?? undefined,
      toolOptionsOverride: input.toolOptionsOverride
    },
    {
      jobId,
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: 200,
      ...(typeof input.delayMs === "number" && input.delayMs > 0 ? { delay: input.delayMs } : {})
    }
  );

  return { runId, attemptNo };
}

export async function setWorkflowPhase(
  workflowTaskId: string,
  phase: string,
  stateJson?: Record<string, unknown>
): Promise<void> {
  await query(
    `UPDATE task_workflows
        SET phase = $2,
            state_json = CASE WHEN $3::jsonb IS NULL THEN state_json ELSE $3::jsonb END,
            updated_at = now()
      WHERE task_id = $1`,
    [workflowTaskId, phase, stateJson ? JSON.stringify(stateJson) : null]
  );
}

export async function getLatestWorkflowMessageNo(workflowTaskId: string): Promise<number> {
  const result = await query<{ latest_message_no: number | null }>(
    `SELECT COALESCE(MAX(message_no), 0)::int AS latest_message_no
       FROM task_workflow_messages
      WHERE workflow_task_id = $1`,
    [workflowTaskId]
  );

  return clampNonNegativeInteger(result.rows[0]?.latest_message_no, 0);
}

import type { TaskExecutionJob } from "@meowbert/shared";
import type { LoadedWorkflowRunContext } from "./context.js";
import { enqueueWorkflowTaskRun, setWorkflowPhase } from "./shared.js";
import fs from "node:fs/promises";
import path from "node:path";
import { query } from "../../lib/db.js";

const LONG_HORIZON_REVIEWER_COUNT = 1;

function getReviewerCount(context: LoadedWorkflowRunContext): number {
  if (context.longHorizon?.enableReviewPhase === false) {
    return 0;
  }
  return Math.min(context.longHorizon?.reviewerCount ?? LONG_HORIZON_REVIEWER_COUNT, LONG_HORIZON_REVIEWER_COUNT)
    || LONG_HORIZON_REVIEWER_COUNT;
}

export async function startLongHorizonTask(context: LoadedWorkflowRunContext, input: {
  plan: string;
  workspaceId: string;
  environmentId: string;
  triggerSource: TaskExecutionJob["triggerSource"];
  selectionUserId?: string | null;
}): Promise<{ planPath: string; nextRunId: string }> {
  if (context.workflowType !== "long_horizon") {
    throw new Error("start_long_horizon_task is only available in Long Horizon workflows.");
  }
  if (!context.currentAgent || context.currentAgent.role !== "main") {
    throw new Error("Only the clarify/main task can start the long-horizon plan.");
  }

  const planPath = path.join(context.taskDir, "PLAN.md");
  await fs.mkdir(context.taskDir, { recursive: true });
  await fs.writeFile(planPath, input.plan, "utf8");

  await query(
    `INSERT INTO task_workflow_submissions (
      workflow_task_id,
      workflow_agent_id,
      submission_type,
      round_no,
      payload_json
    ) VALUES ($1, $2, 'plan', NULL, $3::jsonb)`,
    [context.workflowTaskId, context.currentAgent.id, JSON.stringify({ plan: input.plan })]
  );

  await setWorkflowPhase(context.workflowTaskId, "working", {
    currentRound: 0,
    approvedRound: null
  });

  const nextRun = await enqueueWorkflowTaskRun({
    taskId: context.workflowTaskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: input.triggerSource,
    mode: "long_horizon_main",
    selectionUserId: input.selectionUserId ?? undefined
  });

  return {
    planPath,
    nextRunId: nextRun.runId
  };
}

export async function submitLongHorizonResponse(context: LoadedWorkflowRunContext, input: {
  message: string;
  workspaceId: string;
  environmentId: string;
  triggerSource: TaskExecutionJob["triggerSource"];
}): Promise<{ roundNo: number; reviewerTaskIds: string[] }> {
  if (context.workflowType !== "long_horizon") {
    throw new Error("submit_response is only available in Long Horizon workflows.");
  }
  if (!context.currentAgent || context.currentAgent.role !== "main") {
    throw new Error("Only the long-horizon main task can submit work for review.");
  }

  const nextRound = (context.longHorizon?.latestRound ?? 0) + 1;
  await query(
    `INSERT INTO task_workflow_submissions (
      workflow_task_id,
      workflow_agent_id,
      submission_type,
      round_no,
      payload_json
    ) VALUES ($1, $2, 'long_submit', $3, $4::jsonb)`,
    [context.workflowTaskId, context.currentAgent.id, nextRound, JSON.stringify({ message: input.message, roundNo: nextRound })]
  );

  await setWorkflowPhase(context.workflowTaskId, "reviewing", {
    currentRound: nextRound,
    approvedRound: null
  });

  const reviewerCount = getReviewerCount(context);
  const reviewerAgents = context.agents
    .filter((agent) => agent.role === "reviewer")
    .slice(0, reviewerCount);
  for (const reviewerAgent of reviewerAgents) {
    await enqueueWorkflowTaskRun({
      taskId: reviewerAgent.task_id,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      triggerSource: input.triggerSource,
      mode: context.config.reviewMode === "quality_control"
        ? "quality_control_reviewer"
        : "long_horizon_reviewer"
    });
  }

  return {
    roundNo: nextRound,
    reviewerTaskIds: reviewerAgents.map((agent) => agent.task_id)
  };
}

export async function submitLongHorizonReview(context: LoadedWorkflowRunContext, input: {
  review: string;
  approved: boolean;
  workspaceId: string;
  environmentId: string;
  triggerSource: TaskExecutionJob["triggerSource"];
}): Promise<{
  roundNo: number;
  approvedCount: number;
  rejectedCount: number;
  totalCount: number;
  majority: number;
  outcome: "pending" | "approved" | "changes_requested";
}> {
  if (context.workflowType !== "long_horizon") {
    throw new Error("submit_review is only available in Long Horizon workflows.");
  }
  if (!context.currentAgent || context.currentAgent.role !== "reviewer") {
    throw new Error("Only reviewer agents can submit a review.");
  }

  const roundNo = context.longHorizon?.latestRound ?? 0;
  if (roundNo <= 0) {
    throw new Error("There is no submitted round to review.");
  }

  await query(
    `INSERT INTO task_workflow_submissions (
      workflow_task_id,
      workflow_agent_id,
      submission_type,
      round_no,
      payload_json
    ) VALUES ($1, $2, 'review', $3, $4::jsonb)`,
    [context.workflowTaskId, context.currentAgent.id, roundNo, JSON.stringify({ review: input.review, approved: input.approved })]
  );

  const countsRes = await query<{ approved_count: number; rejected_count: number; total_count: number }>(
    `SELECT COUNT(*) FILTER (WHERE (payload_json->>'approved')::boolean = true)::int AS approved_count,
            COUNT(*) FILTER (WHERE (payload_json->>'approved')::boolean = false)::int AS rejected_count,
            COUNT(*)::int AS total_count
       FROM task_workflow_submissions
      WHERE workflow_task_id = $1
        AND submission_type = 'review'
        AND round_no = $2`,
    [context.workflowTaskId, roundNo]
  );

  const reviewerCount = getReviewerCount(context);
  const majority = Math.floor(reviewerCount / 2) + 1;
  const approvedCount = countsRes.rows[0]?.approved_count ?? 0;
  const rejectedCount = countsRes.rows[0]?.rejected_count ?? 0;
  const totalCount = countsRes.rows[0]?.total_count ?? 0;
  const mainAgent = context.agents.find((agent) => agent.role === "main");

  let outcome: "pending" | "approved" | "changes_requested" = "pending";
  if (approvedCount >= majority) {
    outcome = "approved";
    await setWorkflowPhase(context.workflowTaskId, "approved", {
      currentRound: roundNo,
      approvedRound: roundNo
    });
    if (mainAgent) {
      await enqueueWorkflowTaskRun({
        taskId: mainAgent.task_id,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        triggerSource: input.triggerSource,
        mode: "long_horizon_main"
      });
    }
  } else if (rejectedCount >= (reviewerCount - majority + 1) || totalCount >= reviewerCount) {
    outcome = "changes_requested";
    await setWorkflowPhase(context.workflowTaskId, "working", {
      currentRound: roundNo,
      approvedRound: null
    });
    if (mainAgent) {
      await enqueueWorkflowTaskRun({
        taskId: mainAgent.task_id,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        triggerSource: input.triggerSource,
        mode: "long_horizon_main"
      });
    }
  }

  return {
    roundNo,
    approvedCount,
    rejectedCount,
    totalCount,
    majority,
    outcome
  };
}

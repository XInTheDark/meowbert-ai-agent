import { query } from "../../lib/db.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import {
  clampNonNegativeInteger,
  coerceNullableString
} from "./shared.js";

const LONG_HORIZON_REVIEWER_COUNT = 1;

function buildReviewSummary(input: {
  round: number;
  message: string | null;
  reviews: Array<{
    slotIndex: number | null;
    approved: boolean;
    review: string;
    createdAt: string;
  }>;
  tally: { approvedCount: number; rejectedCount: number; totalCount: number; majority: number };
}): string {
  const lines = [
    `Current review round: ${input.round}.`,
    input.message ? `Submission under review:\n\n${input.message}` : "No submission text was found for the current review round.",
    "",
    `Approval tally: ${input.tally.approvedCount}/${input.tally.majority} approvals needed (${input.tally.rejectedCount} reject, ${input.tally.totalCount} total review(s) submitted).`,
    "",
    "Reviews:"
  ];

  if (input.reviews.length === 0) {
    lines.push("- No reviews submitted yet.");
  } else {
    for (const review of input.reviews) {
      lines.push(
        `- Reviewer ${review.slotIndex !== null ? review.slotIndex + 1 : "?"} · ${review.approved ? "approved" : "requested changes"} · ${review.createdAt}`,
        review.review.trim().length > 0 ? review.review.trim() : "(No review text provided.)"
      );
    }
  }

  return lines.join("\n");
}

function clampPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.floor(value);
}

export async function loadLongHorizonBudgetTelemetry(input: {
  workflowTaskId: string;
  timeBudgetMinutes: number | null;
}): Promise<{
  observedTokenUsage: number;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  isApproachingTimeLimit: boolean;
}> {
  const result = await query<{ total_tokens: string | null; created_at: string | Date | null }>(
    `SELECT
       (SELECT created_at FROM tasks WHERE id = $1) AS created_at,
       COALESCE(SUM(u.weighted_tokens), 0)::text AS total_tokens
     FROM user_token_usage_events u
     WHERE u.task_id IN (
       SELECT a.task_id
         FROM task_workflow_agents a
        WHERE a.workflow_task_id = $1
       UNION
       SELECT $1::uuid
     )`,
    [input.workflowTaskId]
  );

  const observedTokenUsage = Number.parseInt(result.rows[0]?.total_tokens ?? "0", 10);
  const startedAt = result.rows[0]?.created_at ? new Date(result.rows[0].created_at) : new Date();
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
  const totalBudgetSeconds = input.timeBudgetMinutes ? input.timeBudgetMinutes * 60 : null;
  const remainingSeconds = totalBudgetSeconds !== null
    ? Math.max(0, totalBudgetSeconds - elapsedSeconds)
    : null;

  return {
    observedTokenUsage: Number.isFinite(observedTokenUsage) && observedTokenUsage > 0 ? observedTokenUsage : 0,
    elapsedSeconds,
    remainingSeconds,
    isApproachingTimeLimit: totalBudgetSeconds !== null
      && elapsedSeconds >= Math.max(Math.floor(0.9 * totalBudgetSeconds), Math.max(0, totalBudgetSeconds - 300))
  };
}

export async function buildLongHorizonContext(input: {
  workflowTaskId: string;
  configJson: Record<string, unknown>;
  stateJson: Record<string, unknown>;
}): Promise<LoadedWorkflowRunContext["longHorizon"]> {
  const enableClarifyPhase = input.configJson.enableClarifyPhase !== false;
  const enableReviewPhase = input.configJson.enableReviewPhase !== false;
  const reviewerCount = enableReviewPhase
    ? (Math.min(
      clampNonNegativeInteger(input.configJson.reviewerCount, LONG_HORIZON_REVIEWER_COUNT) || LONG_HORIZON_REVIEWER_COUNT,
      LONG_HORIZON_REVIEWER_COUNT
    ))
    : 0;
  const tokenBudget = clampPositiveInteger(input.configJson.tokenBudget);
  const timeBudgetMinutes = clampPositiveInteger(input.configJson.timeBudgetMinutes);
  const budgetTelemetry = await loadLongHorizonBudgetTelemetry({
    workflowTaskId: input.workflowTaskId,
    timeBudgetMinutes
  });
  const latestSubmissionRes = await query<{
    round_no: number | null;
    payload_json: { message?: string; roundNo?: number };
    created_at: string;
  }>(
    `SELECT round_no, payload_json, created_at
       FROM task_workflow_submissions
      WHERE workflow_task_id = $1
        AND submission_type = 'long_submit'
      ORDER BY round_no DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [input.workflowTaskId]
  );

  const latestSubmission = latestSubmissionRes.rows[0] ?? null;
  const latestRound = clampNonNegativeInteger(
    latestSubmission?.round_no ?? latestSubmission?.payload_json?.roundNo ?? input.stateJson.currentRound,
    0
  );
  const reviewRowsRes = latestRound > 0
    ? await query<{
      approved: boolean | null;
      review: string | null;
      created_at: string;
      slot_index: number | null;
    }>(
      `SELECT (s.payload_json->>'approved')::boolean AS approved,
              s.payload_json->>'review' AS review,
              s.created_at,
              a.slot_index
         FROM task_workflow_submissions s
         LEFT JOIN task_workflow_agents a
           ON a.id = s.workflow_agent_id
        WHERE s.workflow_task_id = $1
          AND s.submission_type = 'review'
          AND s.round_no = $2
        ORDER BY a.slot_index ASC, s.created_at ASC`,
      [input.workflowTaskId, latestRound]
    )
    : { rows: [] };

  const approvedCount = reviewRowsRes.rows.filter((row) => row.approved === true).length;
  const rejectedCount = reviewRowsRes.rows.filter((row) => row.approved === false).length;
  const totalCount = reviewRowsRes.rows.length;
  const majority = Math.floor(reviewerCount / 2) + 1;
  const latestSubmissionMessage = coerceNullableString(latestSubmission?.payload_json?.message) ?? null;

  return {
    latestRound,
    latestSubmissionMessage,
    latestSubmissionCreatedAt: latestSubmission?.created_at ?? null,
    reviewerCount,
    currentReviewSummary: latestRound > 0
      ? buildReviewSummary({
        round: latestRound,
        message: latestSubmissionMessage,
        reviews: reviewRowsRes.rows.map((row) => ({
          slotIndex: row.slot_index,
          approved: row.approved === true,
          review: row.review ?? "",
          createdAt: row.created_at
        })),
        tally: { approvedCount, rejectedCount, totalCount, majority }
      })
      : null,
    latestReviewRound: latestRound,
    approvedRound: typeof input.stateJson.approvedRound === "number"
      ? clampNonNegativeInteger(input.stateJson.approvedRound)
      : null,
    tokenBudget,
    observedTokenUsage: budgetTelemetry.observedTokenUsage,
    timeBudgetMinutes,
    elapsedSeconds: budgetTelemetry.elapsedSeconds,
    remainingSeconds: budgetTelemetry.remainingSeconds,
    isApproachingTimeLimit: budgetTelemetry.isApproachingTimeLimit,
    enableClarifyPhase,
    enableReviewPhase,
    latestApprovalTally: latestRound > 0
      ? { approvedCount, rejectedCount, totalCount, majority }
      : null
  };
}

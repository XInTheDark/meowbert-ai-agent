import { describe, expect, it } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import {

  shouldAllowWorkflowFinalResponse,
  shouldAllowWorkflowRequestClarification,
  shouldAllowWorkflowStartLongHorizon,
  shouldAllowWorkflowSubmitResponse,
  shouldAllowWorkflowSubmitReview
} from "./prompts.js";

function makeContext(overrides: Partial<LoadedWorkflowRunContext> = {}): LoadedWorkflowRunContext {
  return {
    workflowTaskId: "workflow-1",
    workflowType: "long_horizon",
    phase: "working",
    config: {},
    taskId: "task-1",
    taskDir: "/tmp/task",
    workspaceId: "workspace-1",
    environmentId: "environment-1",
    currentAgent: null,
    agents: [],
    planContent: null,
    longHorizon: {
      latestRound: 0,
      latestSubmissionMessage: null,
      latestSubmissionCreatedAt: null,
      reviewerCount: 1,
      currentReviewSummary: null,
      latestReviewRound: 0,
      approvedRound: null,
      tokenBudget: null,
      observedTokenUsage: 0,
      timeBudgetMinutes: null,
      elapsedSeconds: 0,
      remainingSeconds: null,
      isApproachingTimeLimit: false,
      enableClarifyPhase: true,
      enableReviewPhase: true,
      latestApprovalTally: null
    },
    ...overrides
  };
}

describe("workflow action gates", () => {
  it("allows final responses only at the workflow's permitted completion stage", () => {
    expect(shouldAllowWorkflowFinalResponse(null, "default")).toBe(true);
    expect(shouldAllowWorkflowFinalResponse(makeContext(), "long_horizon_main")).toBe(false);
    expect(shouldAllowWorkflowFinalResponse(makeContext({ phase: "approved" }), "long_horizon_main")).toBe(true);
    expect(shouldAllowWorkflowFinalResponse(makeContext({ phase: "completed" }), "long_horizon_main")).toBe(false);
    expect(shouldAllowWorkflowFinalResponse(makeContext({
      longHorizon: { ...makeContext().longHorizon!, enableReviewPhase: false }
    }), "long_horizon_main")).toBe(true);
  });

  it("allows clarification and plan start only for the clarify agent", () => {
    const clarifyContext = makeContext({ phase: "clarify" });
    expect(shouldAllowWorkflowRequestClarification(clarifyContext, "long_horizon_clarify")).toBe(true);
    expect(shouldAllowWorkflowStartLongHorizon(clarifyContext, "long_horizon_clarify")).toBe(true);
    expect(shouldAllowWorkflowRequestClarification(clarifyContext, "long_horizon_main")).toBe(false);
    expect(shouldAllowWorkflowStartLongHorizon(makeContext(), "long_horizon_clarify")).toBe(false);
  });

  it("allows response submission only while the main agent is working toward review", () => {
    expect(shouldAllowWorkflowSubmitResponse(makeContext(), "long_horizon_main")).toBe(true);
    expect(shouldAllowWorkflowSubmitResponse(makeContext({ phase: "approved" }), "long_horizon_main")).toBe(false);
    expect(shouldAllowWorkflowSubmitResponse(makeContext({ phase: "completed" }), "long_horizon_main")).toBe(false);
    expect(shouldAllowWorkflowSubmitResponse(makeContext({
      longHorizon: { ...makeContext().longHorizon!, enableReviewPhase: false }
    }), "long_horizon_main")).toBe(false);
    expect(shouldAllowWorkflowSubmitResponse(makeContext(), "long_horizon_reviewer")).toBe(false);
  });

  it("allows reviews only for active reviewer runs, including Quality Control reviewers", () => {
    const reviewingContext = makeContext({ phase: "reviewing" });
    expect(shouldAllowWorkflowSubmitReview(reviewingContext, "long_horizon_reviewer")).toBe(true);
    expect(shouldAllowWorkflowSubmitReview(reviewingContext, "quality_control_reviewer")).toBe(true);
    expect(shouldAllowWorkflowSubmitReview(reviewingContext, "long_horizon_main")).toBe(false);
    expect(shouldAllowWorkflowSubmitReview(makeContext({ phase: "completed" }), "quality_control_reviewer")).toBe(false);
  });
});

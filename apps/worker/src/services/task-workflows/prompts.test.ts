import { describe, expect, it } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import {
  buildWorkflowPromptContext,
  shouldAllowSwarmChannelTools,
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
    expect(shouldAllowWorkflowFinalResponse(makeContext({
      workflowType: "agent_swarm",
      phase: "active"
    }), "agent_swarm_leader")).toBe(true);
    expect(shouldAllowWorkflowFinalResponse(makeContext({
      workflowType: "agent_swarm",
      phase: "completed"
    }), "agent_swarm_leader")).toBe(false);
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

  it("exposes swarm tools only while an Agent Swarm workflow is active", () => {
    expect(shouldAllowSwarmChannelTools(makeContext({ workflowType: "agent_swarm", phase: "active" }))).toBe(true);
    expect(shouldAllowSwarmChannelTools(makeContext({ workflowType: "agent_swarm", phase: "completed" }))).toBe(false);
    expect(shouldAllowSwarmChannelTools(makeContext({ workflowType: "long_horizon" }))).toBe(false);
    expect(shouldAllowSwarmChannelTools(null)).toBe(false);
  });
});

describe("Swarm node catalog", () => {
  const buildLeaderPrompt = (tokenBudget: number | null) => buildWorkflowPromptContext(makeContext({
    workflowType: "agent_swarm",
    phase: "active",
    currentAgent: { id: "leader", role: "leader", task_id: "task-1", slot_index: 0, state_json: {} } as never,
    config: { tokenBudget, dynamicNodeTypes: [{
      id: "luna", name: "Luna", description: "Focused research", spawnableAsNode: true
    }] }
  }), "agent_swarm_leader");

  it("shows node descriptions and the one-agent roster to the leader", () => {
    expect(buildLeaderPrompt(50_000_000).guide).toContain("luna: Luna — Focused research · leader luna · workers none");
  });

  it("hides spawnable nodes when the swarm has no budget", () => {
    const guide = buildLeaderPrompt(null).guide;
    expect(guide).not.toContain("luna: Luna");
    expect(guide).not.toContain("swarm_spawn_node");
  });
});

describe("Swarm prompt caching", () => {
  const buildLeaderPrompt = (swarm: Partial<NonNullable<LoadedWorkflowRunContext["swarm"]>>) => buildWorkflowPromptContext(makeContext({
    workflowType: "agent_swarm",
    phase: "active",
    currentAgent: { id: "leader", role: "leader", task_id: "task-1", slot_index: 0, state_json: {} } as never,
    agents: [{ id: "worker", role: "worker", task_id: "worker-1", slot_index: 0, state_json: {} } as never],
    swarm: {
      sharedDir: "/tmp/shared",
      channels: [],
      peerTaskDirs: [],
      globalChannelId: "global-channel",
      latestWorkflowMessageNo: 0,
      leaderGlobalMessageCount: 0,
      activeWorkerCount: 0,
      workerGlobalReportTaskIds: [],
      workerGlobalReportLabels: [],
      missingWorkerGlobalReportTaskIds: [],
      missingWorkerGlobalReportLabels: [],
      workersStartedAt: null,
      completedReviewRounds: 0,
      finalReview: null,
      ...swarm
    }
  }), "agent_swarm_leader");

  it("keeps per-run swarm state out of the cached system prompt and guide", () => {
    const before = buildLeaderPrompt({});
    const after = buildLeaderPrompt({
      workersStartedAt: "2026-10-09T00:00:00.000Z",
      missingWorkerGlobalReportTaskIds: ["worker-1"],
      missingWorkerGlobalReportLabels: ["Worker 1"],
      latestWorkflowMessageNo: 40,
      finalReview: { reviewerTaskId: "worker-1", reviewerLabel: "Worker 1", approved: true, summary: "Ready." }
    });

    expect(after.section).toBe(before.section);
    expect(after.guide).toBe(before.guide);
    expect(after.liveState).not.toBe(before.liveState);
    expect(after.liveState).toContain("Still waiting on reports from: Worker 1");
  });
});

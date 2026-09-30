import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("./shared.js", async () => {
  const actual = await vi.importActual<typeof import("./shared.js")>("./shared.js");
  return {
    ...actual,
    enqueueWorkflowTaskRun: vi.fn(),
    setWorkflowPhase: vi.fn()
  };
});

import { query } from "../../lib/db.js";
import { submitLongHorizonResponse } from "./long-horizon.js";
import { enqueueWorkflowTaskRun, setWorkflowPhase } from "./shared.js";

function buildContext(): LoadedWorkflowRunContext {
  const mainAgent = {
    id: "main-agent",
    role: "main" as const,
    slot_index: 0,
    task_id: "main-task",
    title: "Main",
    status: "running",
    task_root_path: ".meowbert/task-runs/main-task",
    last_inbox_refresh_message_no: 0,
    state_json: {}
  };
  const reviewerAgent = {
    id: "reviewer-agent",
    role: "reviewer" as const,
    slot_index: 0,
    task_id: "reviewer-task",
    title: "Reviewer",
    status: "awaiting_input",
    task_root_path: ".meowbert/task-runs/reviewer-task",
    last_inbox_refresh_message_no: 0,
    state_json: {}
  };

  return {
    workflowTaskId: "workflow-1",
    workflowType: "long_horizon",
    phase: "working",
    config: { reviewMode: "quality_control" },
    taskId: "main-task",
    taskDir: "/tmp/main-task",
    workspaceId: "workspace-1",
    environmentId: "environment-1",
    currentAgent: mainAgent,
    agents: [mainAgent, reviewerAgent],
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
    runtime: {
      lastPassiveRefreshAtMs: 0,
      lastExplicitRefreshWorkflowMessageNo: 0,
      pendingChannelMessageSendAfterRefresh: false
    }
  };
}

describe("submitLongHorizonResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as never);
    vi.mocked(setWorkflowPhase).mockResolvedValue(undefined);
    vi.mocked(enqueueWorkflowTaskRun).mockResolvedValue({ runId: "run-1", attemptNo: 1 });
  });

  it("starts a Quality Control reviewer with the database-supported run kind", async () => {
    await expect(submitLongHorizonResponse(buildContext(), {
      message: "The completed work is ready for review.",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      triggerSource: "web"
    })).resolves.toEqual({
      roundNo: 1,
      reviewerTaskIds: ["reviewer-task"]
    });

    expect(enqueueWorkflowTaskRun).toHaveBeenCalledWith({
      taskId: "reviewer-task",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      triggerSource: "web",
      mode: "quality_control_reviewer"
    });
  });
});

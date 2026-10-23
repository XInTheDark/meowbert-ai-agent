import type { WorkflowAgentRecord } from "./shared.js";

export interface WorkflowPromptContext {
  roleSummary: string;
  section: string;
  embeddedPersonalityIds?: string[];
  // A role guide sent as its own instruction after the system prompt; stable across runs.
  guide?: string;
  // State that changes between runs, added to the conversation at the start of the run.
  liveState?: string;
}

export interface LoadedWorkflowRunContext {
  workflowTaskId: string;
  workflowType: "long_horizon";
  phase: string;
  config: Record<string, unknown>;
  taskId: string;
  workflowTaskDir?: string;
  taskDir: string;
  workspaceId: string;
  environmentId: string;
  currentAgent: WorkflowAgentRecord | null;
  agents: WorkflowAgentRecord[];
  planContent: string | null;
  longHorizon?: {
    latestRound: number;
    latestSubmissionMessage: string | null;
    latestSubmissionCreatedAt: string | null;
    reviewerCount: number;
    currentReviewSummary: string | null;
    latestReviewRound: number;
    approvedRound: number | null;
    tokenBudget: number | null;
    observedTokenUsage: number;
    timeBudgetMinutes: number | null;
    elapsedSeconds: number;
    remainingSeconds: number | null;
    isApproachingTimeLimit: boolean;
    enableClarifyPhase: boolean;
    enableReviewPhase: boolean;
    latestApprovalTally: {
      approvedCount: number;
      rejectedCount: number;
      totalCount: number;
      majority: number;
    } | null;
  };
}

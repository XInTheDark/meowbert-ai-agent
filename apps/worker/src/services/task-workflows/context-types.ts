import type { TaskWorkflowType } from "@meowbert/shared";
import type { WorkflowAgentRecord, WorkflowAgentRole } from "./shared.js";

export interface SwarmChannelSummary {
  id: string;
  kind: "global" | "direct" | "group";
  title: string | null;
  created_at: string;
  latest_message_no: number;
  unread_count: number;
  member_task_ids: string[];
}

export interface SwarmInboxRefreshResult {
  delivered: boolean;
  latestWorkflowMessageNo: number;
  unreadMessageCount: number;
  bundleText: string;
  channels: Array<{
    channelId: string;
    title: string | null;
    kind: "global" | "direct" | "group";
    unreadCount: number;
    deliveredCount: number;
    overflowCount: number;
    latestMessageNo: number;
  }>;
}

export interface WorkflowPromptContext {
  roleSummary: string;
  section: string;
  embeddedPersonalityIds?: string[];
}

export interface LoadedWorkflowRunContext {
  workflowTaskId: string;
  workflowType: TaskWorkflowType;
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
  swarm?: {
    sharedDir: string;
    channels: SwarmChannelSummary[];
    peerTaskDirs: Array<{ taskId: string; title: string | null; role: WorkflowAgentRole; slotIndex: number; taskDir: string }>;
    globalChannelId: string | null;
    latestWorkflowMessageNo: number;
    leaderGlobalMessageCount: number;
    activeWorkerCount: number;
    workerGlobalReportTaskIds: string[];
    workerGlobalReportLabels: string[];
    missingWorkerGlobalReportTaskIds: string[];
    missingWorkerGlobalReportLabels: string[];
    workersStartedAt: string | null;
    lastWaitCycleTaskIds?: string[];
    completedReviewRounds: number;
    pendingNestedSwarmNodeIds?: string[];
    finalReview: {
      reviewerTaskId: string;
      reviewerLabel: string;
      approved: boolean;
      summary: string;
    } | null;
  };
  runtime: {
    lastPassiveRefreshAtMs: number;
    lastExplicitRefreshWorkflowMessageNo: number;
    pendingChannelMessageSendAfterRefresh: boolean;
    pendingChannelMessageSwarmNodeId?: string | null;
  };
}

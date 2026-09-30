import type { ConversationOrganizationState } from "../agent/conversation-organization.js";
import type { PlatformAgentPreset } from "@meowbert/shared";
import type { SubagentRuntime } from "../subagents/types.js";
import type { PlatformModelCompatibilityMode, PlatformModelType, TaskExecutionJob, TaskSource } from "@meowbert/shared";
import type { DockerSandboxHandle } from "@meowbert/shared/docker-sandbox";
import type { FunctionTool, ResponseInputItem } from "openai/resources/responses/responses";
import type { TaskMessageToolOptions } from "../agent/types.js";
import type { McpConnection } from "../agent/mcp-client.js";
import type { TaskLiveSyncFileSummary } from "../agent/live-sync-types.js";
import type { WorkspaceImageDetail } from "../workspaces/workspace-model-settings.js";
import type { LoadedWorkflowRunContext } from "../task-workflows/service.js";
import type { SwarmTarget } from "../task-workflows/swarm-target.js";
import type { SwarmBudgetStatus } from "../task-workflows/agent-swarm-budget.js";
import type { ContextManagementV2State } from "../context-management-v2/index.js";

export interface ToolDispatchContext {
  subagentRuntime?: SubagentRuntime;
  subagentFastAgent?: string | null;
  subagentPresets?: PlatformAgentPreset[];
  allowTaskHistoryTools?: boolean;
  isProjectMaster?: boolean;
  runId: string;
  taskId: string;
  workspaceId: string;
  environmentId: string;
  actorUserId: string | null;
  selectionUserId?: string | null;
  compatibilityModes?: PlatformModelCompatibilityMode[];
  modelType?: PlatformModelType;
  searchWeb?: (query: string) => Promise<string>;
  contextManagementV2?: ContextManagementV2State | null;
  taskDir: string;
  taskRootPath?: string;
  envRoot: string;
  workspaceRoot: string;
  liveSyncFiles: TaskLiveSyncFileSummary[];
  sandbox: DockerSandboxHandle;
  shellEnvOverrides: Record<string, string>;
  shellNetworkEnabled: boolean;
  workspaceRunAsRoot?: boolean;
  triggerSource: TaskSource;
  connectorContextId: string | null;
  defaultTimezone: string;
  runMode: TaskExecutionJob["mode"];
  runToolOptions: TaskMessageToolOptions;
  isThreadTask: boolean;
  shellToolMaxTimeoutMs: number;
  persistentRuntimeEnabled: boolean;
  imageDetail?: WorkspaceImageDetail;
  skillsRootDir: string | null;
  isSkillAdmin: boolean;
  activeMcpConnections: Map<string, McpConnection>;
  activeSkillTools: FunctionTool[];
  enableSkillById: (skillId: string) => Promise<{ doc: string | null; toolNames: string[] }>;
  initializeSandbox?: () => Promise<{ alreadyInitialized: boolean }>;
  appendPromptDelta?: (input: { reason: string; content: string; role?: "developer" | "system" }) => void;
  refreshGitHubToken?: () => Promise<{ ok: boolean; login?: string; expiresAt?: string | null; error?: string }>;
  getCurrentLeafMessageId: () => string | null;
  setCurrentLeafMessageId: (messageId: string) => void;
  cancellationSignal?: AbortSignal;
  assertNotCancelled: () => Promise<void>;
  workflowContext?: LoadedWorkflowRunContext | null;
  workflowActions?: {
    startLongHorizonTask?: (plan: string) => Promise<{ planPath: string; nextRunId: string }>;
    submitLongHorizonResponse?: (message: string) => Promise<{ roundNo: number; reviewerTaskIds: string[] }>;
    submitLongHorizonReview?: (
      review: string,
      approved: boolean
    ) => Promise<{
      roundNo: number;
      approvedCount: number;
      rejectedCount: number;
      totalCount: number;
      majority: number;
      outcome: "pending" | "approved" | "changes_requested";
    }>;
    refreshSwarmInbox?: (mode: "passive" | "explicit", targetSwarm?: SwarmTarget) => Promise<{
      delivered: boolean;
      latestWorkflowMessageNo: number;
      unreadMessageCount: number;
      bundleText: string;
    }>;
    manageSwarmWorkers?: (input: {
      targetSwarm?: SwarmTarget;
      start: string[];
      stop: string[];
      grantBudget: Array<{ worker: string; tokens: number }>;
      viewOnly: boolean;
    }) => Promise<{
      started: string[];
      stopped: string[];
      granted: Array<{ label: string; tokens: number }>;
      workers: Array<{
        taskId: string;
        label: string;
        status: string;
        stopped: boolean;
        paused: boolean;
        pauseReason: string | null;
        waitingForTaskIds: string[];
      }>;
      agents: Array<{
        taskId: string;
        label: string;
        status: string;
        stopped: boolean;
        paused: boolean;
        pauseReason: string | null;
        waitingForTaskIds: string[];
      }>;
      waitCycleTaskIds: string[];
      lastDetectedWaitCycleTaskIds: string[];
    }>;
    getSwarmBudgetStatus?: (targetSwarm?: SwarmTarget) => Promise<SwarmBudgetStatus>;
    spawnSwarmNode?: (input: {
      targetSwarm?: SwarmTarget;
      nodeTypeId: string;
      title: string;
      initialInstruction: string | null;
      tokenBudget: number;
      timeBudgetMinutes: number | null;
    }) => Promise<{
      nodeId: string;
      title: string;
      status: string;
      leaderTaskId: string;
      workerTaskIds: string[];
      allocatedTokens: number;
      deadlineAt: string | null;
    }>;
    grantSwarmBudget?: (input: {
      targetSwarm?: SwarmTarget;
      nodeId: string;
      additionalTokens: number;
      extendDeadlineMinutes: number | null;
    }) => Promise<{
      nodeId: string;
      allocatedTokens: number;
      remainingTokens: number;
      deadlineAt: string | null;
      resumed: boolean;
    }>;
    cancelSwarmNode?: (input: {
      targetSwarm?: SwarmTarget;
      nodeId: string;
      reason: string;
    }) => Promise<{ nodeId: string; cancelledNodeIds: string[] }>;
    recordSwarmReviewRound?: (input: { targetSwarm?: SwarmTarget; reviewer: string; summary: string }) => Promise<{
      completedRounds: number;
      requiredRounds: number;
      reviewerLabel: string;
    }>;
    recordSwarmFinalReview?: (input: { targetSwarm?: SwarmTarget; reviewer: string; approved: boolean; summary: string }) => Promise<{
      reviewerLabel: string;
      approved: boolean;
    }>;
    listSwarmChannels?: (targetSwarm?: SwarmTarget) => Promise<Array<{
      id: string;
      kind: "global" | "direct" | "group";
      title: string | null;
      created_at: string;
      latest_message_no: number;
      unread_count: number;
      member_task_ids: string[];
    }>>;
    readSwarmChannel?: (input: { targetSwarm?: SwarmTarget; channelId: string; sinceMessageNo?: number | null }) => Promise<{
      channelId: string;
      messages: Array<{
        id: string;
        messageNo: number;
        createdAt: string;
        senderTaskId: string | null;
        senderRole: "main" | "reviewer" | "leader" | "worker" | null;
        senderSlotIndex: number | null;
        contentMarkdown: string;
      }>;
    }>;
    createSwarmChannel?: (input: {
      targetSwarm?: SwarmTarget;
      memberAgentTaskIds: string[];
      title?: string | null;
    }) => Promise<{
      channelId: string;
      kind: "direct" | "group";
      title: string | null;
      memberTaskIds: string[];
    }>;
    sendSwarmChannelMessage?: (input: { targetSwarm?: SwarmTarget; channelId: string; message: string; pauseAfterSend: boolean; waitingForTaskIds?: string[] | null }) => Promise<{
      messageNo: number;
      createdAt: string;
      paused: boolean;
    }>;
    submitSwarmOutput?: (response: string, targetSwarm?: SwarmTarget) => Promise<{ messageNo: number }>;
    pauseSwarmAgent?: (input: { targetSwarm?: SwarmTarget; status: string; waitingForTaskIds?: string[] | null }) => Promise<void>;
  };
}

export interface BudgetTelemetry {
  tokenBudget?: number | null;
  observedTokenUsage?: number;
  timeBudgetMinutes?: number | null;
  elapsedSeconds?: number;
  remainingSeconds?: number | null;
  isWrapUpRequired?: boolean;
}

export interface ToolDispatchState {
  organization?: ConversationOrganizationState;
  subagentWaitDeadline?: string;
  repeatedToolCall?: { name: string; parameters: string; count: number };
  conversationItems: ResponseInputItem[];
  runPersistedItems: ResponseInputItem[];
  contextUsage?: {
    usedTokens: number;
    maxContextTokens: number;
    percent: number;
  } | null;
  budgetTelemetry?: BudgetTelemetry | null;
  commandStep: number;
  finalResponseSegments?: Array<{ response: string; notify: boolean; partial: boolean; summary?: string }>;
  pendingContextManagementAction?:
    | {
        kind: "compact";
        checkpoint: string;
        callId: string;
      }
    | {
        kind: "trim";
        checkpoint: string;
        toolSummary: string;
        count: number;
        callId: string;
      }
    | null;
  pendingContextV2Reset?: boolean;
}

export interface ToolDispatchResult {
  sawToolCall: boolean;
  sawFunctionToolCall: boolean;
  finalResponse: {
    summary?: string;
    response: string;
    notify: boolean;
    partial: boolean;
  } | null;
  waitRequest: {
    response: string;
    notify: boolean;
    seconds: number | null;
    nextRunAt: string | null;
  } | null;
  stopRequest: {
    response: string;
    notify: boolean;
  } | null;
  workflowPause:
    | {
      kind: "long_horizon_started" | "long_horizon_submitted" | "long_horizon_reviewed" | "long_horizon_clarification_requested" | "agent_swarm_paused";
      response?: string;
    }
    | null;
}

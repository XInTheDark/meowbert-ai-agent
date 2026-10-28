import type { ConversationOrganizationState } from "../agent/conversation-organization.js";
import type { PlatformAgentPreset } from "@meowbert/shared";
import type { SubagentRuntime } from "../subagents/types.js";
import type { PlatformModelCompatibilityMode, PlatformModelType, TaskExecutionJob, TaskSource } from "@meowbert/shared";
import type { MachineHandle as DockerSandboxHandle } from "@meowbert/shared/docker-sandbox";
import type { FunctionTool, ResponseInputItem } from "openai/resources/responses/responses";
import type { TaskMessageToolOptions } from "../agent/types.js";
import type { McpConnection } from "../agent/mcp-client.js";
import type { SkillSummary } from "../agent/skill-registry.js";
import type { TaskLiveSyncFileSummary } from "../agent/live-sync-types.js";
import type { WorkspaceImageDetail } from "../workspaces/workspace-model-settings.js";
import type { LoadedWorkflowRunContext } from "../task-workflows/context-types.js";
import type { ContextManagementV2State } from "../context-management-v2/types.js";
import type { ContextWindowUsage } from "../context-management-v2/token-usage.js";
import type { ContextEditRequest } from "../context-management-v2/context-edits.js";
import type { RunControl } from "../agent/ports/run-control.js";
import type { ExecutorSettings } from "../agent/ports/executor-settings.js";
import type { RunFeatures } from "../agent/ports/run-features.js";
import type { ProjectMasterTaskAgent } from "../project-master/task-agent.js";
import type { SwarmDispatchContext } from "../agent-swarm/dispatch-context.js";
import type { SwarmLaneResult, SwarmParkReason } from "../agent-swarm/lane-types.js";

export interface ToolDispatchContext {
  control: RunControl;
  settings: ExecutorSettings;
  features: RunFeatures;
  subagentRuntime?: SubagentRuntime;
  subagentFastAgent?: string | null;
  subagentPresets?: PlatformAgentPreset[];
  allowTaskHistoryTools?: boolean;
  memoryEnabled?: boolean;
  isProjectMaster?: boolean;
  projectMasterTaskAgent?: ProjectMasterTaskAgent | null;
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
  taskScratchDir: string;
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
  // Idle compaction turns may only use the notes and history tools; any other call gets an error.
  notesOnly?: boolean;
  runToolOptions: TaskMessageToolOptions;
  isThreadTask: boolean;
  shellToolMaxTimeoutMs: number;
  persistentRuntimeEnabled: boolean;
  imageDetail?: WorkspaceImageDetail;
  skillsRootDir: string | null;
  isSkillAdmin: boolean;
  activeMcpConnections: Map<string, McpConnection>;
  activeSkillTools: FunctionTool[];
  // Tools this turn offers only through exec (code mode); unset when code mode is off.
  codeModeTools?: FunctionTool[];
  // Set while a tool runs inside exec, so its display message is never replayed as a model call.
  codeModeParentCallId?: string;
  enableSkillById: (skillId: string) => Promise<{ doc: string | null; toolNames: string[] }>;
  // Offered without being loaded; list_skills shows them even when the skill is hidden from the catalog.
  onDemandSkills?: SkillSummary[];
  initializeSandbox?: () => Promise<{ alreadyInitialized: boolean }>;
  appendPromptDelta?: (input: { reason: string; content: string; role?: "developer" | "system" }) => void;
  refreshGitHubToken?: () => Promise<{ ok: boolean; login?: string; expiresAt?: string | null; error?: string }>;
  getCurrentLeafMessageId: () => string | null;
  setCurrentLeafMessageId: (messageId: string) => void;
  cancellationSignal?: AbortSignal;
  assertNotCancelled: () => Promise<void>;
  workflowContext?: LoadedWorkflowRunContext | null;
  // Set for every run of an Agent Swarm task (leader and lanes).
  swarm?: SwarmDispatchContext | null;
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
  // A swarm call that ends the run: the caller parks until its lanes finish, or a lane submits.
  swarmPark?: { reason: SwarmParkReason };
  swarmSubmit?: SwarmLaneResult;
  repeatedToolCall?: { name: string; parameters: string; count: number };
  conversationItems: ResponseInputItem[];
  runPersistedItems: ResponseInputItem[];
  contextUsage?: {
    usedTokens: number;
    maxContextTokens: number;
    percent: number;
  } | null;
  // V2 active-window accounting; contextUsage remains the exact previous request's input usage.
  contextWindowUsage?: ContextWindowUsage | null;
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
  // V2 call numbers assigned in this run, by provider call id, and the highest number in use.
  callNumbers?: Map<string, number>;
  lastCallNumber?: number;
  // Context edits requested this turn, applied together at the turn boundary.
  pendingContextEdits?: ContextEditRequest[];
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
      kind: "long_horizon_started" | "long_horizon_submitted" | "long_horizon_reviewed" | "long_horizon_clarification_requested";
      response?: string;
    }
    | null;
}

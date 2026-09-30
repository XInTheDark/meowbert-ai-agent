import type { TaskExecutionJob } from "@meowbert/shared";
import type { ToolDispatchContext, ToolDispatchState } from "../agent-tool-dispatch/index.js";
import type { createPromptEnvelope } from "./prompt-envelope.js";
import type { getTaskScheduleInfo } from "../task-schedules/service.js";
import type { LoadedWorkflowRunContext, WorkflowPromptContext } from "../task-workflows/service.js";
import type { PreparedAgentRunContext } from "./runtime.js";
import type { TaskDebugLogger } from "../runtime/debug-task-events.js";
import type { ContextManagementState } from "../context-management-v2/index.js";
import type { ResponseInputItem } from "openai/resources/responses/responses";

export type PromptEnvelopeState = ReturnType<typeof createPromptEnvelope>;
export type AgentScheduleInfo = Awaited<ReturnType<typeof getTaskScheduleInfo>>;
export type WorkflowActions = NonNullable<ToolDispatchContext["workflowActions"]>;

export interface FinalResponseRequest {
  summary?: string;
  response: string;
  notify: boolean;
  partial?: boolean;
}

export interface WaitRequest extends FinalResponseRequest {
  seconds: number | null;
  nextRunAt: string | null;
}

export interface WorkflowPauseRequest {
  kind: "long_horizon_started" | "long_horizon_submitted" | "long_horizon_reviewed" | "long_horizon_clarification_requested" | "agent_swarm_paused";
  response?: string;
}

export interface AgentRunControlState {
  isTimedInfiniteRun: boolean;
  runDeadlineAtMs: number | null;
  runTimedOut: boolean;
  reachedMaxRunSteps: boolean;
  timedRunFinalizing: boolean;
  timedRunFinalizationPromptInjected: boolean;
  runTimeLimitController: AbortController | null;
  runTimeLimitTimer: NodeJS.Timeout | null;
  runAbortSignal: AbortSignal;
}

export interface WorkflowCapabilityState {
  workflowContext: LoadedWorkflowRunContext | null;
  workflowPromptContext: WorkflowPromptContext | null;
  allowWorkflowFinalResponse: boolean;
  allowWorkflowStartLongHorizon: boolean;
  allowWorkflowRequestClarification: boolean;
  allowWorkflowSubmitResponse: boolean;
  allowWorkflowSubmitReview: boolean;
  allowSwarmTools: boolean;
}

export interface AgentExecutionState {
  contextManagement: ContextManagementState;
  currentLeafMessageId: string | null;
  dispatchState: ToolDispatchState;
  shouldRecordTokenUsage: boolean;
  hasActualContextUsage: boolean;
  lastActualContextUsage: {
    inputTokens: number;
    estimatedInputTokens: number;
  } | null;
  finalResponseFromTool: FinalResponseRequest | null;
  waitRequest: WaitRequest | null;
  stopRequest: FinalResponseRequest | null;
  workflowPauseRequest: WorkflowPauseRequest | null;
  workflowAssistantPauseResponse: string | null;
  notificationRequested: boolean;
  quickModeActive: boolean;
}

export interface AgentExecutionContext {
  job: TaskExecutionJob;
  prepared: PreparedAgentRunContext;
  manualClearItems: ResponseInputItem[] | null;
  debugLogger: TaskDebugLogger;
  taskInputDir: string;
  scheduleInfo: AgentScheduleInfo;
  allowScheduleTools: boolean;
  allowSubtaskTools: boolean;
  allowStopTask: boolean;
  maxRunSteps: number;
  recurringStateFilePath: string | null;
  workflow: WorkflowCapabilityState;
  systemPrompt: string;
  promptEnvelope: PromptEnvelopeState;
  runControl: AgentRunControlState;
  state: AgentExecutionState;
  assertRunNotAborted: () => Promise<void>;
  injectTimedRunFinalizationPrompt: () => void;
  initializeQuickModeSandbox: () => Promise<{ alreadyInitialized: boolean }>;
}

export interface AgentFailureContext {
  job: TaskExecutionJob;
  prepared: PreparedAgentRunContext;
  state: Pick<AgentExecutionState, "currentLeafMessageId">;
}

export interface AgentStepAvailability {
  allowFinalResponseTool: boolean;
  allowWaitTool: boolean;
  allowSwarmPauseTool: boolean;
  allowSwarmManageTool: boolean;
  allowSwarmReviewTool: boolean;
  allowSwarmFinalReviewTool: boolean;
  allowSwarmOutputTool: boolean;
  allowStopTaskTool: boolean;
  requireWorkflowToolAction: boolean;
  stepsRemaining: number;
  isWindingDown: boolean;
  quickModeActive: boolean;
}

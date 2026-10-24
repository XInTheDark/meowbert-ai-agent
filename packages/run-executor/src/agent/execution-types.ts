import type { TaskExecutionJob } from "@meowbert/shared";
import type { ToolDispatchContext, ToolDispatchState } from "../agent-tool-dispatch/index.js";
import type { createPromptEnvelope } from "./prompt-envelope.js";
import type { RunScheduleInfo } from "./ports/run-bootstrap.js";
import type { LoadedWorkflowRunContext, WorkflowPromptContext } from "../task-workflows/context-types.js";
import type { PreparedAgentRunContext } from "./runtime.js";
import type { TaskDebugLogger } from "./run-debug-logger.js";
import type { SkillSummary } from "./skill-registry.js";
import type { ContextManagementState } from "../context-management-v2/types.js";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { SwarmRunContext } from "../agent-swarm/run-context.js";
import type { ForkSeed } from "../agent-swarm/fork-types.js";

export type PromptEnvelopeState = ReturnType<typeof createPromptEnvelope>;
export type AgentScheduleInfo = RunScheduleInfo | null;
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
  kind: "long_horizon_started" | "long_horizon_submitted" | "long_horizon_reviewed" | "long_horizon_clarification_requested";
  response?: string;
}

export interface AgentRunTimingState {
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
}

export interface AgentExecutionState {
  contextManagement: ContextManagementState;
  currentLeafMessageId: string | null;
  dispatchState: ToolDispatchState;
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
  // Model turns taken in this run.
  stepCount: number;
}

export interface AgentExecutionContext {
  job: TaskExecutionJob;
  prepared: PreparedAgentRunContext;
  manualClearItems: ResponseInputItem[] | null;
  debugLogger: TaskDebugLogger;
  taskInputDir: string;
  scheduleInfo: AgentScheduleInfo;
  allowScheduleTools: boolean;
  loadedToolGroups: Set<string>;
  // enable_skill entry point: skills, plus the built-in tool groups this run may load.
  enableSkillById: (skillId: string) => Promise<{ doc: string | null; toolNames: string[] }>;
  // Skills and tool groups offered without being loaded (hidden ones included), for list_skills.
  onDemandCapabilities: SkillSummary[];
  allowSubtaskTools: boolean;
  allowStopTask: boolean;
  maxRunSteps: number;
  recurringStateFilePath: string | null;
  workflow: WorkflowCapabilityState;
  // Set for every run of an Agent Swarm task; `laneSeed` for forked lanes, which run on their seed.
  swarm: SwarmRunContext | null;
  laneSeed: ForkSeed | null;
  systemPrompt: string;
  promptEnvelope: PromptEnvelopeState;
  runTiming: AgentRunTimingState;
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
  allowStopTaskTool: boolean;
  requireWorkflowToolAction: boolean;
  stepsRemaining: number;
  isWindingDown: boolean;
  quickModeActive: boolean;
}

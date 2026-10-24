import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { PlatformModelRouter, TaskExecutionJob } from "@meowbert/shared";
import type { RunContextStore } from "./run-control.js";
import type { AgentExecutionContext, WorkflowActions } from "../execution-types.js";
import type { TaskMessageRow, TaskRow } from "../types.js";
import type { BudgetTelemetry, ToolDispatchContext, ToolDispatchState } from "../../agent-tool-dispatch/types.js";
import type { ToolCallResult } from "../../agent-tool-dispatch/tool-call-result.js";
import type { LoadedWorkflowRunContext } from "../../task-workflows/context-types.js";
import type { SwarmRunContext } from "../../agent-swarm/run-context.js";
import type { LaneRunSetup } from "../../agent-swarm/fork-types.js";

export type AppendAssistantMessage = (text: string) => Promise<void>;

// Agent Swarm, subagents, Project Master and Long Horizon workflows keep their state on the server,
// so the executor reaches them only through these hooks. An executor without them offers none of
// those features; the server refuses them for such runs.
export interface RunFeatures {
  loadWorkflow(input: { taskId: string; envRoot: string; workspaceId: string }): Promise<LoadedWorkflowRunContext | null>;
  workflowActions(execution: AgentExecutionContext): WorkflowActions | undefined;
  loadWorkflowBudget(execution: AgentExecutionContext): Promise<BudgetTelemetry | null>;
  // False when the workflow had already moved on, so this run must not finish it.
  completeWorkflow(context: LoadedWorkflowRunContext, runId: string): Promise<boolean>;

  loadSwarm(task: TaskRow, routers: PlatformModelRouter[]): Promise<SwarmRunContext | null>;
  prepareLaneRun(input: {
    contextStore: RunContextStore;
    taskId: string;
    lane: NonNullable<SwarmRunContext["lane"]>;
    messages: TaskMessageRow[];
    branchLeafMessageId: string | null;
    runtimeModel: string;
  }): Promise<LaneRunSetup>;

  // Mail, notes and budget updates that arrive between turns, appended to the conversation.
  beforeStep(execution: AgentExecutionContext): Promise<void>;
  afterModelTurn(execution: AgentExecutionContext, weightedTokens: number | null): Promise<void>;

  // Handles the features' own tools; null for any other tool.
  handleToolCall(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> | null;
  assertSubagentsFinished(taskId: string): Promise<void>;
  // A swarm run's final_response can start a Check first; null lets it through.
  interceptFinalResponse(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult | null>;

  finalizeSwarmRun(execution: AgentExecutionContext, appendAssistantMessage: AppendAssistantMessage): Promise<boolean>;
  parkLeaderIfLanesActive(execution: AgentExecutionContext): Promise<boolean>;
  parkForSubagentMail(job: TaskExecutionJob, deadline: string): Promise<void>;
}

function unavailable(feature: string): never {
  throw new Error(`${feature} is not available for this run.`);
}

// For executors that run outside the control plane.
export const noRunFeatures: RunFeatures = {
  loadWorkflow: async () => null,
  workflowActions: () => undefined,
  loadWorkflowBudget: async () => null,
  completeWorkflow: async () => true,
  loadSwarm: async () => null,
  prepareLaneRun: async () => unavailable("Agent Swarm"),
  beforeStep: async () => {},
  afterModelTurn: async () => {},
  handleToolCall: () => null,
  assertSubagentsFinished: async () => {},
  interceptFinalResponse: async () => null,
  finalizeSwarmRun: async () => false,
  parkLeaderIfLanesActive: async () => false,
  parkForSubagentMail: async () => unavailable("Subagents")
};

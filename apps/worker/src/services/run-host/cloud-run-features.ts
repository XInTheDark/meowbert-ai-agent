import { SUBAGENT_TOOL_NAMES } from "@meowbert/run-executor/agent-tools/subagents";
import { PROJECT_MASTER_TOOL_NAMES } from "@meowbert/run-executor/agent-tools/project-master";
import { PROJECT_MAP_TOOL_NAMES } from "@meowbert/run-executor/agent-tools/project-map";
import type { RunFeatures } from "@meowbert/run-executor/agent/ports/run-features";
import type { AgentExecutionContext, WorkflowActions } from "@meowbert/run-executor/agent/execution-types";
import type { BudgetTelemetry } from "@meowbert/run-executor/agent-tool-dispatch/types";
import { createSwarmRunFeatures } from "@meowbert/run-executor/agent-swarm/features";
import { handleSubagentTool } from "../agent-tool-dispatch/handlers/subagents.js";
import { handleProjectMasterTool } from "../agent-tool-dispatch/handlers/project-master.js";
import { dbSwarmBackend } from "../agent-swarm/db-backend.js";
import { appendSubagentInbox } from "../subagents/inbox.js";
import { assertSubagentsFinished } from "../subagents/mail.js";
import { parkForSubagentMail } from "../subagents/wait.js";
import { appendProjectMasterInbox } from "../project-master/inbox.js";
import { handleProjectMapTool } from "../agent-tool-dispatch/handlers/project-map.js";
import { appendQueuedUserMessages } from "../queued-messages/inbox.js";
import {
  loadLongHorizonBudgetTelemetry,
  loadWorkflowRunContext,
  markWorkflowCompleted,
  startLongHorizonTask,
  submitLongHorizonResponse,
  submitLongHorizonReview
} from "../task-workflows/service.js";

function buildWorkflowActions(execution: AgentExecutionContext): WorkflowActions | undefined {
  const { workflow, prepared, job } = execution;
  const context = workflow.workflowContext;
  if (!context) {
    return undefined;
  }
  const target = {
    workspaceId: prepared.snapshot.task.workspace_id,
    environmentId: prepared.snapshot.task.environment_id,
    triggerSource: job.triggerSource
  };

  return {
    startLongHorizonTask: workflow.allowWorkflowStartLongHorizon
      ? async (plan: string) => startLongHorizonTask(context, { ...target, plan, selectionUserId: job.selectionUserId ?? null })
      : undefined,
    submitLongHorizonResponse: workflow.allowWorkflowSubmitResponse
      ? async (message: string) => submitLongHorizonResponse(context, { ...target, message })
      : undefined,
    submitLongHorizonReview: workflow.allowWorkflowSubmitReview
      ? async (review: string, approved: boolean) => submitLongHorizonReview(context, { ...target, review, approved })
      : undefined
  };
}

async function loadWorkflowBudget(execution: AgentExecutionContext): Promise<BudgetTelemetry | null> {
  const context = execution.workflow.workflowContext;
  const longHorizon = context?.longHorizon;
  if (!context || !longHorizon || (!longHorizon.tokenBudget && !longHorizon.timeBudgetMinutes)) {
    return null;
  }

  const telemetry = await loadLongHorizonBudgetTelemetry({
    workflowTaskId: context.workflowTaskId,
    timeBudgetMinutes: longHorizon.timeBudgetMinutes
  });
  const { tokenBudget } = longHorizon;
  const remainingTokens = tokenBudget !== null ? tokenBudget - telemetry.observedTokenUsage : null;
  return {
    tokenBudget,
    observedTokenUsage: telemetry.observedTokenUsage,
    timeBudgetMinutes: longHorizon.timeBudgetMinutes,
    elapsedSeconds: telemetry.elapsedSeconds,
    remainingSeconds: telemetry.remainingSeconds,
    isWrapUpRequired: (remainingTokens !== null && remainingTokens <= 0) || telemetry.isApproachingTimeLimit
  };
}

const swarmFeatures = createSwarmRunFeatures(dbSwarmBackend);

// The database-backed features, for runs whose executor sits inside the control plane.
export const cloudRunFeatures: RunFeatures = {
  loadWorkflow: (input) => loadWorkflowRunContext(input),
  workflowActions: buildWorkflowActions,
  loadWorkflowBudget,
  completeWorkflow: (context, runId) => markWorkflowCompleted(context, { currentRunId: runId }),
  loadSwarm: swarmFeatures.loadSwarm,
  prepareLaneRun: swarmFeatures.prepareLaneRun,
  async beforeStep(execution) {
    await appendQueuedUserMessages(execution);
    await appendSubagentInbox(execution);
    await appendProjectMasterInbox(execution);
    await swarmFeatures.beforeStep(execution);
  },
  afterModelTurn: swarmFeatures.afterModelTurn,
  handleToolCall(call, ctx, state) {
    const swarmResult = swarmFeatures.handleToolCall(call, ctx, state);
    if (swarmResult) return swarmResult;
    if ((SUBAGENT_TOOL_NAMES as readonly string[]).includes(call.name)) return handleSubagentTool(call, ctx, state);
    if ((PROJECT_MASTER_TOOL_NAMES as readonly string[]).includes(call.name)) return handleProjectMasterTool(call, ctx, state);
    if ((PROJECT_MAP_TOOL_NAMES as readonly string[]).includes(call.name)) return handleProjectMapTool(call, ctx, state);
    return null;
  },
  assertSubagentsFinished,
  interceptFinalResponse: swarmFeatures.interceptFinalResponse,
  finalizeSwarmRun: swarmFeatures.finalizeSwarmRun,
  parkLeaderIfLanesActive: swarmFeatures.parkLeaderIfLanesActive,
  parkForSubagentMail
};

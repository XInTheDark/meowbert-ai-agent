import type { ApiClient } from "../../../lib/api";
import type {
  TaskAttachment,
  TaskDetail,
  TaskParameters,
  TaskToolOptions,
  TaskWorkflowComposerConfig,
  TaskWorkflowOverview
} from "../../../lib/types";
import { buildTaskSchedulePayload } from "../../../task/taskParameters";
import { joinTaskMessage } from "../../../lib/utils";

export type TaskScheduleAction = "pause" | "resume" | "run-now";

export interface TaskFollowUpResponse {
  taskId: string;
  mode: "enqueued" | "interrupting";
  runId?: string;
  attemptNo?: number;
  messageId?: string;
  activeLeafMessageId?: string;
}

function buildWorkflowPayload(workflow: TaskWorkflowComposerConfig): Record<string, unknown> {
  return {
    type: workflow.type,
    ...(workflow.type === "agent_swarm" ? {
      workerCount: workflow.workerCount,
      reviewRounds: workflow.reviewRounds,
      tokenBudget: workflow.tokenBudget,
      timeBudgetMinutes: workflow.timeBudgetMinutes,
      ...(workflow.disableSpawningAndBudgets ? { disableSpawningAndBudgets: true } : {}),
      ...(workflow.leaderAgentId ? { leaderAgentId: workflow.leaderAgentId } : {}),
      ...(workflow.modelAllocations.length > 0 ? { modelAllocations: workflow.modelAllocations } : {})
    } : {}),
    ...(workflow.type === "long_horizon" || workflow.type === "deep_research" || workflow.type === "quality_control" ? {
      tokenBudget: workflow.tokenBudget,
      timeBudgetMinutes: workflow.timeBudgetMinutes,
      enableClarifyPhase: workflow.enableClarifyPhase,
      enableReviewPhase: workflow.enableReviewPhase
    } : {})
  };
}

function buildToolsPayload(
  toolOptions: TaskToolOptions,
  workspaceMemoryEnabled: boolean,
  allowComputerUse: boolean,
  options?: {
    allowScheduleTask?: boolean;
    allowSubtasks?: boolean;
  }
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (toolOptions.webSearch) {
    payload.webSearch = true;
  }
  if (workspaceMemoryEnabled && toolOptions.memorySearch) {
    payload.memorySearch = true;
  }
  if ((options?.allowScheduleTask ?? true) && toolOptions.scheduleTask) {
    payload.scheduleTask = true;
  }
  if ((options?.allowSubtasks ?? true) && toolOptions.subtasks) {
    payload.subtasks = true;
  }
  if (allowComputerUse && toolOptions.computerUse) {
    payload.computerUse = true;
  }
  if (toolOptions.interactiveCanvas) {
    payload.interactiveCanvas = true;
  }
  if (toolOptions.enabledSkills.length > 0) {
    payload.enabledSkills = toolOptions.enabledSkills;
  }
  if (toolOptions.enabledSources.length > 0) {
    payload.enabledSources = toolOptions.enabledSources;
  }

  return payload;
}

export async function requestTaskInterrupt(api: ApiClient, taskId: string): Promise<void> {
  await api.post(`/api/tasks/${taskId}/cancel`, {});
}

export async function sendTaskFollowUp(args: {
  api: ApiClient;
  taskId: string;
  followUp: string;
  attachments: TaskAttachment[];
  editingMessageId: string | null;
  toolOptions: TaskToolOptions;
  workspaceMemoryEnabled: boolean;
  allowComputerUse: boolean;
  selectedAgentId: string | null;
  allowScheduleTask?: boolean;
  allowSubtasks?: boolean;
  interactiveCanvasId?: string | null;
  interactiveCanvasIntent?: "create" | "update" | "view" | null;
}): Promise<TaskFollowUpResponse> {
  const toolsPayload = buildToolsPayload(
    args.toolOptions,
    args.workspaceMemoryEnabled,
    args.allowComputerUse,
    {
      allowScheduleTask: args.allowScheduleTask,
      allowSubtasks: args.allowSubtasks
    }
  );
  const hasTools = Object.keys(toolsPayload).length > 0;
  const requestPath = args.editingMessageId
    ? `/api/tasks/${args.taskId}/messages/${args.editingMessageId}/edit`
    : `/api/tasks/${args.taskId}/messages`;

  return args.api.post<TaskFollowUpResponse>(requestPath, {
    message: joinTaskMessage(args.followUp, args.attachments),
    attachments: args.attachments,
    ...(args.interactiveCanvasId
      ? {
          interactiveCanvasId: args.interactiveCanvasId,
          interactiveCanvasIntent: args.interactiveCanvasIntent ?? "update"
        }
      : {}),
    ...(hasTools ? { tools: toolsPayload } : {}),
    ...(args.selectedAgentId ? { agent: { id: args.selectedAgentId } } : {})
  });
}

export async function switchTaskBranch(
  api: ApiClient,
  taskId: string,
  activeLeafMessageId: string
): Promise<void> {
  await api.post(`/api/tasks/${taskId}/branch-selection`, { activeLeafMessageId });
}

export async function interruptTaskCommand(
  api: ApiClient,
  taskId: string,
  step: number
): Promise<void> {
  await api.post(`/api/tasks/${taskId}/commands/interrupt`, { step });
}

export async function compactTaskContext(
  api: ApiClient,
  taskId: string,
  contextAction: "compact" | "clear" = "compact"
): Promise<void> {
  await api.post<{
    taskId: string;
    mode: "compact_only";
    contextAction: "compact" | "clear";
    runId: string;
    attemptNo: number;
  }>(`/api/tasks/${taskId}/compact`, { contextAction });
}

export async function runTaskScheduleAction(
  api: ApiClient,
  taskId: string,
  action: TaskScheduleAction
): Promise<{ mode?: "enqueued" | "pending"; runId?: string }> {
  return api.post<{ mode?: "enqueued" | "pending"; runId?: string }>(
    `/api/tasks/${taskId}/schedule/${action}`,
    {}
  );
}

export async function updateTaskParameters(
  api: ApiClient,
  taskId: string,
  parameters: {
    maxSteps?: number | null;
    timeLimitSeconds?: number | null;
    allowWaiting?: boolean;
    schedule?: TaskParameters["schedule"];
    workflow?: TaskWorkflowComposerConfig;
    tools?: TaskToolOptions;
  }
): Promise<{
  max_steps_override: number | null;
  time_limit_seconds: number | null;
  allow_waiting: boolean;
  default_timezone: string;
  task_type: NonNullable<TaskDetail["task"]["task_type"]>;
  schedule: TaskDetail["task"]["schedule"];
  workflow: TaskWorkflowOverview | null;
}> {
  return api.patch<{
    max_steps_override: number | null;
    time_limit_seconds: number | null;
    allow_waiting: boolean;
    default_timezone: string;
    task_type: NonNullable<TaskDetail["task"]["task_type"]>;
    schedule: TaskDetail["task"]["schedule"];
    workflow: TaskWorkflowOverview | null;
  }>(`/api/tasks/${taskId}/parameters`, {
    ...(typeof parameters.maxSteps !== "undefined" ? { maxSteps: parameters.maxSteps } : {}),
    ...(typeof parameters.timeLimitSeconds !== "undefined" ? { timeLimitSeconds: parameters.timeLimitSeconds } : {}),
    ...(typeof parameters.allowWaiting !== "undefined" ? { allowWaiting: parameters.allowWaiting } : {}),
    ...(parameters.schedule ? { schedule: buildTaskSchedulePayload(parameters.schedule) } : {}),
    ...(parameters.workflow ? { workflow: buildWorkflowPayload(parameters.workflow) } : {}),
    ...(parameters.tools ? {
      tools: {
        webSearch: parameters.tools.webSearch,
        memorySearch: parameters.tools.memorySearch,
        scheduleTask: parameters.tools.scheduleTask,
        subtasks: parameters.tools.subtasks,
        computerUse: parameters.tools.computerUse,
        enabledSkills: parameters.tools.enabledSkills,
        enabledSources: parameters.tools.enabledSources
      }
    } : {})
  });
}

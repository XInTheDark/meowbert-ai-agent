import {
  clampAgentSwarmWorkerCount,
  clampAgentSwarmReviewRounds,
  limitAgentSwarmAgentAllocations,
  normalizeAgentSwarmAgentAllocations,
  sumAgentSwarmAgentAllocations
} from "@meowbert/shared/agent-swarm";
import { buildDefaultTaskParameters, normalizeTaskParameters } from "./taskParameters";
import { TaskAttachment, TaskParameters, TaskToolOptions, TaskWorkflowComposerConfig } from "../lib/types";

const TASK_INPUT_DRAFTS_STORAGE_KEY = "meowbert_task_composer_drafts_v1";
const HTML_CANVAS_SKILL_ID = "html-canvas";

export interface TaskInputDraftDefaults {
  memorySearch?: boolean;
  defaultToolset?: Partial<TaskToolOptions> | null;
}

export interface TaskInputDraft {
  prompt: string;
  attachments: TaskAttachment[];
  toolOptions: TaskToolOptions;
  agentId: string | null;
  composerTaskId: string | null;
  quickMode: boolean;
  taskParameters: TaskParameters;
  workflow: TaskWorkflowComposerConfig;
}

export function buildDefaultTaskWorkflowComposerConfig(): TaskWorkflowComposerConfig {
  return {
    type: "standard",
    workerCount: 3,
    reviewRounds: 0,
    leaderAgentId: null,
    modelAllocations: [],
    tokenBudget: null,
    timeBudgetMinutes: null,
    enableClarifyPhase: true,
    enableReviewPhase: true
  };
}

export function buildDefaultTaskToolOptions(defaults?: TaskInputDraftDefaults): TaskToolOptions {
  const defaultToolset = defaults?.defaultToolset;
  return normalizeInteractiveCanvasToolOptions({
    webSearch: defaultToolset?.webSearch === true,
    memorySearch: defaults?.memorySearch === true,
    scheduleTask: defaultToolset?.scheduleTask === true,
    subtasks: defaultToolset?.subtasks === true,
    computerUse: defaultToolset?.computerUse === true,
    interactiveCanvas: defaultToolset?.interactiveCanvas === true,
    enabledSkills: normalizeToolIdList(defaultToolset?.enabledSkills),
    enabledSources: normalizeToolIdList(defaultToolset?.enabledSources)
  });
}

export function buildEmptyTaskInputDraft(defaults?: TaskInputDraftDefaults): TaskInputDraft {
  return {
    prompt: "",
    attachments: [],
    toolOptions: buildDefaultTaskToolOptions(defaults),
    agentId: null,
    composerTaskId: null,
    quickMode: false,
    taskParameters: buildDefaultTaskParameters(),
    workflow: buildDefaultTaskWorkflowComposerConfig()
  };
}

export const EMPTY_TASK_INPUT_DRAFT: TaskInputDraft = buildEmptyTaskInputDraft();

function normalizeToolIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  ));
}

function removeHtmlCanvasSkill(skillIds: string[]): string[] {
  return skillIds.filter((skillId) => skillId !== HTML_CANVAS_SKILL_ID);
}

export function normalizeInteractiveCanvasToolOptions(options: TaskToolOptions): TaskToolOptions {
  if (options.interactiveCanvas !== true) {
    return options;
  }

  return {
    ...options,
    enabledSkills: removeHtmlCanvasSkill(options.enabledSkills)
  };
}

function normalizeAttachmentSize(value: unknown): number | null | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value === null) {
    return null;
  }

  return undefined;
}

function normalizeTaskAttachment(value: unknown): TaskAttachment | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    id?: unknown;
    kind?: unknown;
    label?: unknown;
    content?: unknown;
    relativePath?: unknown;
    sizeBytes?: unknown;
    forceInclude?: unknown;
  };

  if (
    (candidate.kind !== "note" && candidate.kind !== "file" && candidate.kind !== "directory" && candidate.kind !== "canvas")
    || typeof candidate.label !== "string"
    || typeof candidate.content !== "string"
  ) {
    return null;
  }

  const normalized: TaskAttachment = {
    id: typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id
      : crypto.randomUUID(),
    kind: candidate.kind,
    label: candidate.label,
    content: candidate.content
  };

  if (typeof candidate.relativePath === "string" && candidate.relativePath.length > 0) {
    normalized.relativePath = candidate.relativePath;
  }

  const sizeBytes = normalizeAttachmentSize(candidate.sizeBytes);
  if (sizeBytes !== undefined) {
    normalized.sizeBytes = sizeBytes;
  }

  if (candidate.forceInclude === true) {
    normalized.forceInclude = true;
  }

  return normalized;
}

function normalizeTaskAttachments(value: unknown): TaskAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<TaskAttachment[]>((acc, entry) => {
    const normalized = normalizeTaskAttachment(entry);
    if (normalized) {
      acc.push(normalized);
    }
    return acc;
  }, []);
}

export function normalizeToolOptions(value: unknown, defaults?: TaskInputDraftDefaults): TaskToolOptions {
  const fallback = buildDefaultTaskToolOptions(defaults);
  if (!value || typeof value !== "object") {
    return normalizeInteractiveCanvasToolOptions(fallback);
  }

  const candidate = value as {
    webSearch?: unknown;
    memorySearch?: unknown;
    scheduleTask?: unknown;
    subtasks?: unknown;
    computerUse?: unknown;
    interactiveCanvas?: unknown;
    enabledSkills?: unknown;
    enabledSources?: unknown;
  };
  return normalizeInteractiveCanvasToolOptions({
    webSearch: typeof candidate.webSearch === "boolean" ? candidate.webSearch : fallback.webSearch,
    memorySearch: typeof candidate.memorySearch === "boolean"
      ? candidate.memorySearch
      : fallback.memorySearch,
    scheduleTask: typeof candidate.scheduleTask === "boolean" ? candidate.scheduleTask : fallback.scheduleTask,
    subtasks: typeof candidate.subtasks === "boolean" ? candidate.subtasks : fallback.subtasks,
    computerUse: typeof candidate.computerUse === "boolean" ? candidate.computerUse : fallback.computerUse,
    interactiveCanvas: typeof candidate.interactiveCanvas === "boolean" ? candidate.interactiveCanvas : fallback.interactiveCanvas,
    enabledSkills: Array.isArray(candidate.enabledSkills)
      ? normalizeToolIdList(candidate.enabledSkills)
      : fallback.enabledSkills,
    enabledSources: Array.isArray(candidate.enabledSources)
      ? normalizeToolIdList(candidate.enabledSources)
      : fallback.enabledSources
  });
}

export function normalizeTaskInputDraft(value: unknown, defaults?: TaskInputDraftDefaults): TaskInputDraft {
  const fallback = buildEmptyTaskInputDraft(defaults);
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as {
    prompt?: unknown;
    attachments?: unknown;
    toolOptions?: unknown;
    agentId?: unknown;
    composerTaskId?: unknown;
    quickMode?: unknown;
    taskParameters?: unknown;
    workflow?: unknown;
  };
  return {
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : fallback.prompt,
    attachments: normalizeTaskAttachments(candidate.attachments),
    toolOptions: normalizeToolOptions(candidate.toolOptions, defaults),
    agentId: typeof candidate.agentId === "string" && candidate.agentId.trim().length > 0
      ? candidate.agentId.trim().toLowerCase()
      : fallback.agentId,
    composerTaskId: typeof candidate.composerTaskId === "string" && candidate.composerTaskId.trim().length > 0
      ? candidate.composerTaskId.trim()
      : fallback.composerTaskId,
    quickMode: candidate.quickMode === true,
    taskParameters: normalizeTaskParameters(candidate.taskParameters),
    workflow: (() => {
      if (!candidate.workflow || typeof candidate.workflow !== "object") {
        return fallback.workflow;
      }

      const workflow = candidate.workflow as {
        type?: unknown;
        workerCount?: unknown;
        reviewRounds?: unknown;
        leaderAgentId?: unknown;
        modelAllocations?: unknown;
        tokenBudget?: unknown;
        timeBudgetMinutes?: unknown;
        disableSpawningAndBudgets?: unknown;
        enableClarifyPhase?: unknown;
        enableReviewPhase?: unknown;
      };

      const workflowType = workflow.type === "long_horizon"
        || workflow.type === "deep_research"
        || workflow.type === "quality_control"
        || workflow.type === "agent_swarm"
        ? workflow.type
        : "standard";
      const modelAllocations = limitAgentSwarmAgentAllocations(
        normalizeAgentSwarmAgentAllocations(workflow.modelAllocations)
      );
      const allocationWorkerCount = sumAgentSwarmAgentAllocations(modelAllocations);

      return {
        type: workflowType,
        workerCount: workflowType === "agent_swarm" && allocationWorkerCount > 0
          ? allocationWorkerCount
          : clampAgentSwarmWorkerCount(workflow.workerCount, fallback.workflow.workerCount),
        reviewRounds: workflowType === "agent_swarm"
          && typeof workflow.reviewRounds === "number"
          && Number.isFinite(workflow.reviewRounds)
          ? clampAgentSwarmReviewRounds(workflow.reviewRounds)
          : 0,
        leaderAgentId: workflowType === "agent_swarm" && typeof workflow.leaderAgentId === "string"
          && workflow.leaderAgentId.trim().length > 0
          ? workflow.leaderAgentId.trim().toLowerCase()
          : null,
        modelAllocations: workflowType === "agent_swarm" ? modelAllocations : [],
        tokenBudget: (workflowType === "long_horizon" || workflowType === "deep_research" || workflowType === "quality_control" || workflowType === "agent_swarm")
          && typeof workflow.tokenBudget === "number"
          && Number.isFinite(workflow.tokenBudget)
          && workflow.tokenBudget > 0
          ? Math.floor(workflow.tokenBudget)
          : null,
        timeBudgetMinutes: (workflowType === "long_horizon" || workflowType === "deep_research" || workflowType === "quality_control" || workflowType === "agent_swarm")
          && typeof workflow.timeBudgetMinutes === "number"
          && Number.isFinite(workflow.timeBudgetMinutes)
          && workflow.timeBudgetMinutes > 0
          ? Math.floor(workflow.timeBudgetMinutes)
          : null,
        ...(workflowType === "agent_swarm"
          ? { disableSpawningAndBudgets: workflow.disableSpawningAndBudgets === true }
          : {}),
        enableClarifyPhase: (workflowType === "long_horizon" || workflowType === "deep_research" || workflowType === "quality_control")
          ? workflow.enableClarifyPhase !== false
          : true,
        enableReviewPhase: (workflowType === "long_horizon" || workflowType === "deep_research" || workflowType === "quality_control")
          ? workflow.enableReviewPhase !== false
          : true
      };
    })()
  };
}

export function readTaskInputDrafts(): Record<string, TaskInputDraft> {
  const raw = localStorage.getItem(TASK_INPUT_DRAFTS_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, TaskInputDraft>>(
      (acc, [environmentId, draft]) => {
        acc[environmentId] = normalizeTaskInputDraft(draft);
        return acc;
      },
      {}
    );
  } catch {
    return {};
  }
}

export function writeTaskInputDrafts(draftsByEnvironment: Record<string, TaskInputDraft>): void {
  localStorage.setItem(TASK_INPUT_DRAFTS_STORAGE_KEY, JSON.stringify(draftsByEnvironment));
}

export function getTaskInputDraftForEnvironment(
  draftsByEnvironment: Record<string, TaskInputDraft>,
  environmentId: string | null,
  defaults?: TaskInputDraftDefaults
): TaskInputDraft {
  if (!environmentId) {
    return buildEmptyTaskInputDraft(defaults);
  }
  return draftsByEnvironment[environmentId] ?? buildEmptyTaskInputDraft(defaults);
}

export function shouldRotateRestoredComposerTaskId(draft: TaskInputDraft): boolean {
  return draft.composerTaskId !== null && draft.attachments.length === 0;
}

export function updateTaskInputDraftForEnvironment(
  draftsByEnvironment: Record<string, TaskInputDraft>,
  environmentId: string | null,
  updater: (current: TaskInputDraft) => TaskInputDraft,
  defaults?: TaskInputDraftDefaults
): Record<string, TaskInputDraft> {
  if (!environmentId) {
    return draftsByEnvironment;
  }

  const currentDraft = draftsByEnvironment[environmentId] ?? buildEmptyTaskInputDraft(defaults);
  const nextDraft = normalizeTaskInputDraft(updater(currentDraft), defaults);
  return {
    ...draftsByEnvironment,
    [environmentId]: nextDraft
  };
}

export const getTaskInputDraftForProject = getTaskInputDraftForEnvironment;
export const updateTaskInputDraftForProject = updateTaskInputDraftForEnvironment;

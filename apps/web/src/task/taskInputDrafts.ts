import {
  normalizeAgentSwarmAdvancedSettings,
  normalizeAgentSwarmSpawnEffort,
  normalizeAgentSwarmTimeBudgetMinutes,
  normalizeAgentSwarmTokenBudget
} from "@meowbert/shared/agent-swarm-config";
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
  // The agent the Project Master's tasks run on, kept apart from the Master's own agent. Null means the workspace default.
  masterTaskAgentId: string | null;
  composerTaskId: string | null;
  quickMode: boolean;
  taskParameters: TaskParameters;
  workflow: TaskWorkflowComposerConfig;
}

export function buildDefaultTaskWorkflowComposerConfig(): TaskWorkflowComposerConfig {
  return {
    type: "standard",
    tokenBudget: null,
    timeBudgetMinutes: null,
    enableClarifyPhase: true,
    enableReviewPhase: true
  };
}

export function buildDefaultTaskToolOptions(defaults?: TaskInputDraftDefaults): TaskToolOptions {
  const defaultToolset = defaults?.defaultToolset;
  return normalizeCanvasToolOptions({
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
    masterTaskAgentId: null,
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

// Interactive Canvas and the Canvas skill are one feature now; older drafts and workspace
// defaults that turned on Interactive Canvas mean the Canvas skill.
export function normalizeCanvasToolOptions(options: TaskToolOptions): TaskToolOptions {
  if (options.interactiveCanvas !== true) {
    return options;
  }

  return {
    ...options,
    interactiveCanvas: false,
    enabledSkills: options.enabledSkills.includes(HTML_CANVAS_SKILL_ID)
      ? options.enabledSkills
      : [...options.enabledSkills, HTML_CANVAS_SKILL_ID]
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
    return normalizeCanvasToolOptions(fallback);
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
  return normalizeCanvasToolOptions({
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
    masterTaskAgentId?: unknown;
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
    masterTaskAgentId: typeof candidate.masterTaskAgentId === "string" && candidate.masterTaskAgentId.trim().length > 0
      ? candidate.masterTaskAgentId.trim().toLowerCase()
      : fallback.masterTaskAgentId,
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
        tokenBudget?: unknown;
        timeBudgetMinutes?: unknown;
        enableClarifyPhase?: unknown;
        enableReviewPhase?: unknown;
        routerId?: unknown;
        spawnEffort?: unknown;
        budgetsEnabled?: unknown;
        advanced?: unknown;
      };

      const workflowType = workflow.type === "long_horizon"
        || workflow.type === "deep_research"
        || workflow.type === "quality_control"
        || workflow.type === "agent_swarm"
        ? workflow.type
        : "standard";
      const isLongHorizon = workflowType === "long_horizon" || workflowType === "deep_research" || workflowType === "quality_control";
      const hasBudgets = isLongHorizon || workflowType === "agent_swarm";

      return {
        type: workflowType,
        tokenBudget: hasBudgets ? normalizeAgentSwarmTokenBudget(workflow.tokenBudget) : null,
        timeBudgetMinutes: hasBudgets ? normalizeAgentSwarmTimeBudgetMinutes(workflow.timeBudgetMinutes) : null,
        ...(workflowType === "agent_swarm"
          ? {
              routerId: typeof workflow.routerId === "string" && workflow.routerId.trim() ? workflow.routerId.trim() : null,
              spawnEffort: normalizeAgentSwarmSpawnEffort(workflow.spawnEffort),
              budgetsEnabled: workflow.budgetsEnabled === true,
              advanced: normalizeAgentSwarmAdvancedSettings(workflow.advanced)
            }
          : {}),
        enableClarifyPhase: isLongHorizon ? workflow.enableClarifyPhase !== false : true,
        enableReviewPhase: isLongHorizon ? workflow.enableReviewPhase !== false : true
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

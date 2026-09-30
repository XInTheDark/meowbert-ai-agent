import { useEffect, useMemo, useRef, useState } from "react";
import {
  AGENT_SWARM_DEFAULT_WORKERS,
  AGENT_SWARM_MAX_REVIEW_ROUNDS,
  AGENT_SWARM_MAX_WORKERS,
  AGENT_SWARM_MIN_WORKERS,
  clampAgentSwarmWorkerCount,
  limitAgentSwarmAgentAllocations,
  normalizeAgentSwarmAgentAllocations,
  sumAgentSwarmAgentAllocations,
  type AgentSwarmAgentAllocation
} from "@meowbert/shared/agent-swarm";
import {
  calculateAgentSwarmBudgetEstimate,
  calculateAgentSwarmSystemReserve,
  AGENT_SWARM_DEFAULT_TOKEN_BUDGET,
  AGENT_SWARM_MINIMUM_INFERENCE_TOKENS
} from "@meowbert/shared/agent-swarm-quota";
import { buildDefaultTaskParameters, hasCustomTaskParameters, normalizeTaskParameters } from "../../task/taskParameters";
import type { TaskParameters, TaskType, TaskWorkflowComposerConfig } from "../../lib/types";
import type { AgentSummary } from "./AgentDropdown";
import type { ChatToolsPopoverPlacement } from "./useChatToolsDropdownPlacement";

export type TaskParametersPanel =
  | "menu"
  | "scheduled"
  | "timed"
  | "parameters"
  | "longHorizon"
  | "deepResearch"
  | "qualityControl"
  | "agentSwarm";
export const MAX_LONG_HORIZON_TOKEN_BUDGET = 100_000_000;
export const MAX_LONG_HORIZON_TIME_BUDGET_MINUTES = 10_080;
export const MAX_AGENT_SWARM_TOKEN_BUDGET = 100_000_000;
export const MAX_AGENT_SWARM_TIME_BUDGET_MINUTES = 10_080;
const EMPTY_AGENTS: AgentSummary[] = [];

export interface PendingTypeChange {
  targetTypeLabel: string;
  onConfirm: () => void | Promise<void>;
}

export interface TaskParametersDropdownProps {
  taskParameters: TaskParameters;
  onChange?: (taskParameters: TaskParameters) => void | Promise<void>;
  disabled?: boolean;
  mode?: "create" | "edit";
  taskType?: TaskType;
  workflowConfig?: TaskWorkflowComposerConfig;
  onWorkflowChange?: (workflowConfig: TaskWorkflowComposerConfig) => void | Promise<void>;
  availableAgents?: AgentSummary[];
  selectedAgentId?: string | null;
  defaultAgentId?: string | null;
  popoverPlacement?: ChatToolsPopoverPlacement;
}

export function getCurrentTaskType(props: TaskParametersDropdownProps, resolved: TaskParameters): string {
  if (props.workflowConfig && props.workflowConfig.type !== "standard") {
    return props.workflowConfig.type;
  }
  if (props.taskType === "long_horizon" || props.taskType === "agent_swarm") {
    return props.taskType;
  }
  if (resolved.schedule.type !== "standard") {
    return resolved.schedule.type;
  }
  return "standard";
}

export function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function formatMinutes(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? String(minutes) : String(minutes.toFixed(1));
}

function normalizeLongHorizonTokenBudget(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_LONG_HORIZON_TOKEN_BUDGET, Math.max(1, Math.floor(value)));
}

function normalizeLongHorizonTimeBudget(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_LONG_HORIZON_TIME_BUDGET_MINUTES, Math.max(1, Math.floor(value)));
}

function normalizeAgentSwarmTokenBudget(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_AGENT_SWARM_TOKEN_BUDGET, Math.max(1, Math.floor(value)));
}

function normalizeAgentSwarmTimeBudget(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_AGENT_SWARM_TIME_BUDGET_MINUTES, Math.max(1, Math.floor(value)));
}

function formatTokenBudgetCompact(value: number): string {
  if (value >= 1_000_000) {
    const amount = value / 1_000_000;
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const amount = value / 1_000;
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}K`;
  }
  return String(value);
}

function buildWorkflowSummary(config: TaskWorkflowComposerConfig | undefined): string | null {
  if (!config || config.type === "standard") return null;
  if (config.type === "long_horizon" || config.type === "deep_research" || config.type === "quality_control") {
    const tokenBudget = normalizeLongHorizonTokenBudget(config.tokenBudget);
    const timeBudget = normalizeLongHorizonTimeBudget(config.timeBudgetMinutes);
    const label = config.type === "deep_research"
      ? "Deep Research"
      : config.type === "quality_control" ? "Quality control" : "Long Horizon";

    const parts: string[] = [];
    if (tokenBudget) {
      parts.push(`${formatTokenBudgetCompact(tokenBudget)} tokens`);
    }
    if (timeBudget) {
      parts.push(`${timeBudget}m`);
    }
    return parts.length > 0 ? `${label} · ${parts.join(" · ")}` : label;
  }
  const modelCount = (config.modelAllocations ?? []).filter((item) => item.workerCount > 0).length;
  const budgetParts = [
    normalizeAgentSwarmTokenBudget(config.tokenBudget),
    normalizeAgentSwarmTimeBudget(config.timeBudgetMinutes)
  ].flatMap((value, index) => value === null ? [] : [index === 0 ? `${formatTokenBudgetCompact(value)} tokens` : `${value}m`]);
  const reviewRounds = config.reviewRounds > 0 ? ` · ${config.reviewRounds} review round${config.reviewRounds === 1 ? "" : "s"}` : "";
  return `Agent Swarm · ${config.workerCount} workers${modelCount > 1 ? ` · ${modelCount} models` : ""}${budgetParts.length > 0 ? ` · ${budgetParts.join(" · ")}` : ""}${reviewRounds}`;
}

function resolveDefaultSwarmAgentId(props: TaskParametersDropdownProps, agents: AgentSummary[]): string | null {
  const ids = new Set(agents.map((agent) => agent.id));
  if (props.selectedAgentId && ids.has(props.selectedAgentId)) return props.selectedAgentId;
  if (props.defaultAgentId && ids.has(props.defaultAgentId)) return props.defaultAgentId;
  return agents[0]?.id ?? null;
}

function normalizeAllocations(
  allocations: unknown,
  agents: AgentSummary[],
  fallbackAgentId: string | null,
  fallbackWorkerCount: number
): AgentSwarmAgentAllocation[] {
  const ids = new Set(agents.map((agent) => agent.id));
  const normalized = limitAgentSwarmAgentAllocations(
    normalizeAgentSwarmAgentAllocations(allocations).filter((item) => ids.has(item.agentId))
  );
  return sumAgentSwarmAgentAllocations(normalized) > 0 || fallbackWorkerCount === 0
    ? normalized
    : fallbackAgentId ? [{ agentId: fallbackAgentId, workerCount: clampAgentSwarmWorkerCount(fallbackWorkerCount) }] : [];
}

function useTaskParameterDraft(props: TaskParametersDropdownProps, resolved: TaskParameters) {
  const agents = props.availableAgents ?? EMPTY_AGENTS;
  const [panel, setPanel] = useState<TaskParametersPanel>("menu");
  const [scheduledCron, setScheduledCron] = useState("");
  const [scheduledTimezone, setScheduledTimezone] = useState(getLocalTimezone());
  const [timedMinutes, setTimedMinutes] = useState("");
  const [maxSteps, setMaxSteps] = useState("");
  const [taskTimeLimitMinutes, setTaskTimeLimitMinutes] = useState("");
  const [allowWaiting, setAllowWaiting] = useState(true);
  const [longHorizonTokenBudget, setLongHorizonTokenBudget] = useState("");
  const [longHorizonTimeBudgetMinutes, setLongHorizonTimeBudgetMinutes] = useState("");
  const [longHorizonEnableClarifyPhase, setLongHorizonEnableClarifyPhase] = useState(true);
  const [longHorizonEnableReviewPhase, setLongHorizonEnableReviewPhase] = useState(true);
  const [agentSwarmWorkerCount, setAgentSwarmWorkerCount] = useState(String(AGENT_SWARM_DEFAULT_WORKERS));
  const [agentSwarmAllocations, setAgentSwarmAllocations] = useState<AgentSwarmAgentAllocation[]>([]);
  const [agentSwarmReviewRounds, setAgentSwarmReviewRounds] = useState(0);
  const [agentSwarmLeaderAgentId, setAgentSwarmLeaderAgentId] = useState<string | null>(null);
  const [agentSwarmTokenBudget, setAgentSwarmTokenBudget] = useState("");
  const [agentSwarmTimeBudgetMinutes, setAgentSwarmTimeBudgetMinutes] = useState("");
  const [agentSwarmDisableSpawningAndBudgets, setAgentSwarmDisableSpawningAndBudgets] = useState(false);
  const defaultSwarmAgentId = useMemo(() => resolveDefaultSwarmAgentId(props, agents), [agents, props]);
  return {
    panel, setPanel, scheduledCron, setScheduledCron, scheduledTimezone, setScheduledTimezone,
    timedMinutes, setTimedMinutes, maxSteps, setMaxSteps, taskTimeLimitMinutes, setTaskTimeLimitMinutes,
    allowWaiting, setAllowWaiting, longHorizonTokenBudget, setLongHorizonTokenBudget,
    longHorizonTimeBudgetMinutes, setLongHorizonTimeBudgetMinutes,
    longHorizonEnableClarifyPhase, setLongHorizonEnableClarifyPhase,
    longHorizonEnableReviewPhase, setLongHorizonEnableReviewPhase,
    agentSwarmWorkerCount, setAgentSwarmWorkerCount, agentSwarmAllocations, setAgentSwarmAllocations,
    agentSwarmReviewRounds, setAgentSwarmReviewRounds,
    agentSwarmLeaderAgentId, setAgentSwarmLeaderAgentId,
    agentSwarmTokenBudget, setAgentSwarmTokenBudget,
    agentSwarmTimeBudgetMinutes, setAgentSwarmTimeBudgetMinutes,
    agentSwarmDisableSpawningAndBudgets, setAgentSwarmDisableSpawningAndBudgets,
    defaultSwarmAgentId, agents, resolved
  };
}

function useDraftSynchronization(
  props: TaskParametersDropdownProps,
  isOpen: boolean,
  draft: ReturnType<typeof useTaskParameterDraft>,
  clearError: () => void
) {
  useEffect(() => {
    if (!isOpen) {
      draft.setPanel("menu");
      clearError();
      return;
    }
    draft.setScheduledCron(draft.resolved.schedule.repeat ?? "");
    draft.setScheduledTimezone(draft.resolved.schedule.timezone ?? getLocalTimezone());
    draft.setTimedMinutes(formatMinutes(draft.resolved.schedule.timeLimitSeconds));
    draft.setMaxSteps(draft.resolved.maxSteps ? String(draft.resolved.maxSteps) : "");
    draft.setTaskTimeLimitMinutes(formatMinutes(draft.resolved.timeLimitSeconds));
    draft.setAllowWaiting(draft.resolved.allowWaiting);
    draft.setLongHorizonTokenBudget(props.workflowConfig?.tokenBudget ? String(props.workflowConfig.tokenBudget) : "");
    draft.setLongHorizonTimeBudgetMinutes(props.workflowConfig?.timeBudgetMinutes ? String(props.workflowConfig.timeBudgetMinutes) : "");
    draft.setLongHorizonEnableClarifyPhase(props.workflowConfig?.enableClarifyPhase !== false);
    draft.setLongHorizonEnableReviewPhase(props.workflowConfig?.enableReviewPhase !== false);
    draft.setAgentSwarmWorkerCount(String(clampAgentSwarmWorkerCount(props.workflowConfig?.workerCount, AGENT_SWARM_DEFAULT_WORKERS)));
    draft.setAgentSwarmAllocations(normalizeAllocations(
      props.workflowConfig?.modelAllocations,
      draft.agents,
      draft.defaultSwarmAgentId,
      props.workflowConfig?.workerCount ?? AGENT_SWARM_DEFAULT_WORKERS
    ));
    draft.setAgentSwarmReviewRounds(Math.max(0, Math.min(
      AGENT_SWARM_MAX_REVIEW_ROUNDS,
      Math.floor(props.workflowConfig?.reviewRounds ?? 0)
    )));
    draft.setAgentSwarmLeaderAgentId(
      props.workflowConfig?.leaderAgentId && draft.agents.some((agent) => agent.id === props.workflowConfig?.leaderAgentId)
        ? props.workflowConfig.leaderAgentId
        : draft.defaultSwarmAgentId
    );
    draft.setAgentSwarmTokenBudget(String(props.workflowConfig?.type === "agent_swarm" && props.workflowConfig.tokenBudget
      ? props.workflowConfig.tokenBudget : AGENT_SWARM_DEFAULT_TOKEN_BUDGET));
    draft.setAgentSwarmTimeBudgetMinutes(props.workflowConfig?.type === "agent_swarm" && props.workflowConfig.timeBudgetMinutes
      ? String(props.workflowConfig.timeBudgetMinutes) : "");
    draft.setAgentSwarmDisableSpawningAndBudgets(props.workflowConfig?.type === "agent_swarm"
      && props.workflowConfig.disableSpawningAndBudgets === true);
  }, [
    draft.agents,
    draft.defaultSwarmAgentId,
    draft.resolved,
    isOpen,
    props.workflowConfig?.reviewRounds,
    props.workflowConfig?.modelAllocations,
    props.workflowConfig?.leaderAgentId,
    props.workflowConfig?.tokenBudget,
    props.workflowConfig?.timeBudgetMinutes,
    props.workflowConfig?.disableSpawningAndBudgets,
    props.workflowConfig?.enableClarifyPhase,
    props.workflowConfig?.enableReviewPhase,
    props.workflowConfig?.workerCount,
    props.workflowConfig?.type
  ]);
}

function useTaskScheduleActions(
  props: TaskParametersDropdownProps,
  draft: ReturnType<typeof useTaskParameterDraft>,
  finish: (action: () => Promise<void>, close?: boolean) => Promise<void>,
  setError: (message: string) => void
) {
  const apply = (next: TaskParameters, close = true) => finish(async () => {
    await props.onChange?.(normalizeTaskParameters(next));
  }, close);
  const clearSchedule = () => apply({ ...draft.resolved, schedule: buildDefaultTaskParameters().schedule });
  const applyInfiniteTask = () => apply({ ...draft.resolved, schedule: {
    type: "infinite", repeat: null, timezone: draft.resolved.schedule.timezone ?? getLocalTimezone(),
    timeLimitSeconds: null, deadlineAt: null
  }});
  async function saveScheduledTask() {
    const cron = draft.scheduledCron.trim();
    if (!cron) return setError("Cron is required.");
    await apply({ ...draft.resolved, schedule: {
      type: "scheduled", repeat: cron, timezone: draft.scheduledTimezone.trim() || getLocalTimezone(),
      timeLimitSeconds: null, deadlineAt: null
    }});
  }
  async function saveTimedTask() {
    const minutes = Number(draft.timedMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return setError("Time limit must be a positive number of minutes.");
    await apply({ ...draft.resolved, schedule: {
      type: "timed", repeat: null, timezone: draft.resolved.schedule.timezone ?? getLocalTimezone(),
      timeLimitSeconds: Math.max(1, Math.floor(minutes * 60)), deadlineAt: null
    }});
  }
  async function saveParameters() {
    const maxSteps = draft.maxSteps.trim();
    const parsedSteps = maxSteps ? Number.parseInt(maxSteps, 10) : Number.NaN;
    if (maxSteps && (!Number.isInteger(parsedSteps) || parsedSteps <= 0)) return setError("Max steps must be a positive whole number.");
    const timeLimit = draft.taskTimeLimitMinutes.trim();
    const parsedMinutes = timeLimit ? Number(timeLimit) : Number.NaN;
    if (timeLimit && (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0)) {
      return setError("Task time limit must be a positive number of minutes.");
    }
    await apply({
      ...draft.resolved,
      maxSteps: maxSteps ? parsedSteps : null,
      timeLimitSeconds: timeLimit ? Math.max(60, Math.floor(parsedMinutes * 60)) : null,
      allowWaiting: draft.allowWaiting
    });
  }
  const clearParameters = () => apply({ ...draft.resolved, maxSteps: null, timeLimitSeconds: null, allowWaiting: true });
  return { apply, clearSchedule, applyInfiniteTask, saveScheduledTask, saveTimedTask, saveParameters, clearParameters };
}

function useWorkflowActions(
  props: TaskParametersDropdownProps,
  draft: ReturnType<typeof useTaskParameterDraft>,
  finish: (action: () => Promise<void>, close?: boolean) => Promise<void>,
  setError: (message: string) => void
) {
  const applyWorkflow = (next: TaskWorkflowComposerConfig, close = true) => finish(async () => {
    if (!props.onWorkflowChange) return;
    const allocations = next.type === "agent_swarm"
      ? limitAgentSwarmAgentAllocations(normalizeAgentSwarmAgentAllocations(next.modelAllocations)) : [];
    const allocatedCount = sumAgentSwarmAgentAllocations(allocations);
    const budgetsDisabled = next.type === "agent_swarm" && next.disableSpawningAndBudgets === true;
    await props.onWorkflowChange({
      type: next.type,
      workerCount: next.type === "agent_swarm" && (allocatedCount > 0 || next.workerCount === 0)
        ? allocatedCount : clampAgentSwarmWorkerCount(next.workerCount),
      reviewRounds: next.type === "agent_swarm"
        ? Math.max(0, Math.min(AGENT_SWARM_MAX_REVIEW_ROUNDS, Math.floor(next.reviewRounds)))
        : 0,
      leaderAgentId: next.type === "agent_swarm" ? next.leaderAgentId : null,
      modelAllocations: allocations,
      tokenBudget: budgetsDisabled
        ? null
        : next.type === "agent_swarm"
        ? normalizeAgentSwarmTokenBudget(next.tokenBudget)
        : next.type === "long_horizon" || next.type === "deep_research" || next.type === "quality_control"
          ? normalizeLongHorizonTokenBudget(next.tokenBudget)
          : null,
      timeBudgetMinutes: budgetsDisabled
        ? null
        : next.type === "agent_swarm"
        ? normalizeAgentSwarmTimeBudget(next.timeBudgetMinutes)
        : next.type === "long_horizon" || next.type === "deep_research" || next.type === "quality_control"
          ? normalizeLongHorizonTimeBudget(next.timeBudgetMinutes)
          : null,
      disableSpawningAndBudgets: budgetsDisabled,
      enableClarifyPhase: next.type === "long_horizon" || next.type === "deep_research" || next.type === "quality_control"
        ? next.enableClarifyPhase !== false
        : true,
      enableReviewPhase: next.type === "long_horizon" || next.type === "deep_research" || next.type === "quality_control"
        ? next.enableReviewPhase !== false
        : true
    });
  }, close);
  const clearWorkflow = () => applyWorkflow({
    type: "standard",
    workerCount: props.workflowConfig?.workerCount ?? AGENT_SWARM_DEFAULT_WORKERS,
    reviewRounds: props.workflowConfig?.reviewRounds ?? 0,
    leaderAgentId: null,
    modelAllocations: [],
    tokenBudget: null,
    timeBudgetMinutes: null,
    enableClarifyPhase: true,
    enableReviewPhase: true
  });
  async function saveLongHorizonVariant(type: "long_horizon" | "deep_research" | "quality_control") {
    const tokenVal = draft.longHorizonTokenBudget.trim();
    const tokenParsed = tokenVal ? Number(tokenVal) : Number.NaN;
    if (tokenVal && (!Number.isInteger(tokenParsed) || tokenParsed <= 0 || tokenParsed > MAX_LONG_HORIZON_TOKEN_BUDGET)) {
      return setError(`Token budget must be a whole number from 1 to ${MAX_LONG_HORIZON_TOKEN_BUDGET.toLocaleString()}.`);
    }

    const timeVal = draft.longHorizonTimeBudgetMinutes.trim();
    const timeParsed = timeVal ? Number(timeVal) : Number.NaN;
    if (timeVal && (!Number.isInteger(timeParsed) || timeParsed <= 0 || timeParsed > MAX_LONG_HORIZON_TIME_BUDGET_MINUTES)) {
      return setError(`Time budget must be a whole number from 1 to ${MAX_LONG_HORIZON_TIME_BUDGET_MINUTES.toLocaleString()} minutes.`);
    }

    await applyWorkflow({
      type,
      workerCount: props.workflowConfig?.workerCount ?? AGENT_SWARM_DEFAULT_WORKERS,
      reviewRounds: 0,
      leaderAgentId: null,
      modelAllocations: [],
      tokenBudget: tokenVal ? tokenParsed : null,
      timeBudgetMinutes: timeVal ? timeParsed : null,
      enableClarifyPhase: draft.longHorizonEnableClarifyPhase,
      enableReviewPhase: draft.longHorizonEnableReviewPhase
    });
  }
  const saveLongHorizon = () => saveLongHorizonVariant("long_horizon");
  const saveDeepResearch = () => saveLongHorizonVariant("deep_research");
  const saveQualityControl = () => saveLongHorizonVariant("quality_control");
  async function saveAgentSwarm() {
    const allocated = sumAgentSwarmAgentAllocations(draft.agentSwarmAllocations);
    const hasAllocations = draft.agents.length > 0 && draft.defaultSwarmAgentId !== null;
    const count = hasAllocations ? allocated : Number.parseInt(draft.agentSwarmWorkerCount.trim(), 10);
    if (!Number.isInteger(count) || count < AGENT_SWARM_MIN_WORKERS || count > AGENT_SWARM_MAX_WORKERS) {
      return setError(`Worker count must be a whole number from ${AGENT_SWARM_MIN_WORKERS} to ${AGENT_SWARM_MAX_WORKERS}.`);
    }
    const budgetsDisabled = draft.agentSwarmDisableSpawningAndBudgets;
    const tokenVal = budgetsDisabled ? "" : draft.agentSwarmTokenBudget.trim();
    const tokenParsed = tokenVal ? Number(tokenVal) : Number.NaN;
    if (tokenVal && (!Number.isInteger(tokenParsed) || tokenParsed <= 0 || tokenParsed > MAX_AGENT_SWARM_TOKEN_BUDGET)) {
      return setError(`Token budget must be a whole number from 1 to ${MAX_AGENT_SWARM_TOKEN_BUDGET.toLocaleString()}.`);
    }
    if (tokenVal) {
      const estimate = calculateAgentSwarmBudgetEstimate({
        minimumStepTokens: AGENT_SWARM_MINIMUM_INFERENCE_TOKENS,
        workerSlots: count
      });
      const minimum = calculateAgentSwarmSystemReserve(tokenParsed, estimate.minimumStepTokens)
        + estimate.minimumSpawnAllocationTokens;
      if (tokenParsed < minimum) return setError(`This roster needs at least ${minimum.toLocaleString()} weighted tokens.`);
    }
    const timeVal = budgetsDisabled ? "" : draft.agentSwarmTimeBudgetMinutes.trim();
    const timeParsed = timeVal ? Number(timeVal) : Number.NaN;
    if (timeVal && (!Number.isInteger(timeParsed) || timeParsed <= 0 || timeParsed > MAX_AGENT_SWARM_TIME_BUDGET_MINUTES)) {
      return setError(`Time budget must be a whole number from 1 to ${MAX_AGENT_SWARM_TIME_BUDGET_MINUTES.toLocaleString()} minutes.`);
    }
    if (!tokenVal && !budgetsDisabled) {
      return setError("Agent Swarm needs a token budget.");
    }
    await applyWorkflow({
      type: "agent_swarm", workerCount: count,
      reviewRounds: draft.agentSwarmReviewRounds,
      leaderAgentId: draft.agentSwarmLeaderAgentId ?? draft.defaultSwarmAgentId,
      modelAllocations: hasAllocations ? draft.agentSwarmAllocations : [],
      tokenBudget: tokenVal ? tokenParsed : null,
      timeBudgetMinutes: timeVal ? timeParsed : null,
      disableSpawningAndBudgets: budgetsDisabled
    });
  }
  function updateAgentSwarm(next: TaskWorkflowComposerConfig): Promise<void> {
    return applyWorkflow(next, false);
  }
  return { applyWorkflow, clearWorkflow, saveLongHorizon, saveDeepResearch, saveQualityControl, saveAgentSwarm, updateAgentSwarm };
}

export function useTaskParametersDropdown(props: TaskParametersDropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [pendingTypeChange, setPendingTypeChange] = useState<PendingTypeChange | null>(null);
  const resolved = useMemo(() => normalizeTaskParameters(props.taskParameters), [props.taskParameters]);
  const draft = useTaskParameterDraft(props, resolved);
  const finish = async (action: () => Promise<void>, close = true) => {
    setIsApplying(true);
    setApplyError(null);
    try {
      await action();
      if (close) {
        setIsOpen(false);
        draft.setPanel("menu");
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplying(false);
    }
  };
  const schedule = useTaskScheduleActions(props, draft, finish, setApplyError);
  const workflow = useWorkflowActions(props, draft, finish, setApplyError);
  useDraftSynchronization(props, isOpen, draft, () => setApplyError(null));
  useEffect(() => {
    if (!isOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [isOpen]);
  const workflowSummary = buildWorkflowSummary(props.workflowConfig);
  const scheduleSummary = resolved.schedule.type === "scheduled"
    ? resolved.schedule.repeat ? `Scheduled: ${resolved.schedule.repeat}` : "Scheduled task"
    : resolved.schedule.type === "infinite" ? "Infinite task"
      : resolved.schedule.type === "timed"
        ? resolved.schedule.timeLimitSeconds ? `Timed task: ${formatMinutes(resolved.schedule.timeLimitSeconds)} min` : "Timed task"
        : null;

  const requestTaskTypeChange = (
    targetType: string,
    targetLabel: string,
    action: () => void | Promise<void>
  ) => {
    const currentType = getCurrentTaskType(props, resolved);
    if (props.mode === "edit" && currentType !== targetType) {
      setPendingTypeChange({
        targetTypeLabel: targetLabel,
        onConfirm: async () => {
          setPendingTypeChange(null);
          await action();
        }
      });
    } else {
      void action();
    }
  };

  const confirmTypeChange = async () => {
    if (pendingTypeChange) {
      const { onConfirm } = pendingTypeChange;
      setPendingTypeChange(null);
      await onConfirm();
    }
  };

  const cancelTypeChange = () => {
    setPendingTypeChange(null);
  };

  const applySwarmUpdate = (overrides: Partial<TaskWorkflowComposerConfig>): void => {
    const allocations = overrides.modelAllocations ?? draft.agentSwarmAllocations;
    const allocatedWorkers = sumAgentSwarmAgentAllocations(allocations);
    void workflow.updateAgentSwarm({
      type: "agent_swarm",
      workerCount: allocatedWorkers > 0 || draft.agentSwarmAllocations.length === 0
        ? allocatedWorkers
        : Number.parseInt(draft.agentSwarmWorkerCount, 10) || AGENT_SWARM_DEFAULT_WORKERS,
      reviewRounds: overrides.reviewRounds ?? draft.agentSwarmReviewRounds,
      leaderAgentId: overrides.leaderAgentId ?? draft.agentSwarmLeaderAgentId ?? draft.defaultSwarmAgentId,
      modelAllocations: allocations,
      tokenBudget: overrides.tokenBudget ?? (draft.agentSwarmTokenBudget.trim() ? Number(draft.agentSwarmTokenBudget) : null),
      timeBudgetMinutes: overrides.timeBudgetMinutes ?? (draft.agentSwarmTimeBudgetMinutes.trim() ? Number(draft.agentSwarmTimeBudgetMinutes) : null),
      disableSpawningAndBudgets: overrides.disableSpawningAndBudgets ?? draft.agentSwarmDisableSpawningAndBudgets
    });
  };
  return {
    props, menuRef, isOpen, setIsOpen, isApplying, applyError, setApplyError, draft, schedule, workflow,
    workflowSummary, scheduleSummary,
    pendingTypeChange, requestTaskTypeChange, confirmTypeChange, cancelTypeChange,
    hasCustomParameters: hasCustomTaskParameters(resolved) || workflowSummary !== null,
    hasParameterOverrides: resolved.maxSteps !== null || resolved.timeLimitSeconds !== null || resolved.allowWaiting === false,
    isWorkflowTask: props.taskType === "long_horizon" || props.taskType === "agent_swarm" || (Boolean(props.workflowConfig) && props.workflowConfig?.type !== "standard"),
    canEditWorkflow: typeof props.onWorkflowChange === "function" && Boolean(props.workflowConfig),
    showScheduleControls: true,
    agentSwarmAllocatedWorkers: sumAgentSwarmAgentAllocations(draft.agentSwarmAllocations),
    agentSwarmHasAgentAllocations: draft.agents.length > 0 && draft.defaultSwarmAgentId !== null,
    applySwarmUpdate,
    adjustSwarmAllocation(agentId: string, delta: 1 | -1) {
      draft.setAgentSwarmAllocations((current) => {
        const total = sumAgentSwarmAgentAllocations(current);
        if ((delta > 0 && total >= AGENT_SWARM_MAX_WORKERS) || (delta < 0 && total <= AGENT_SWARM_MIN_WORKERS)) return current;
        const next = [...current];
        const index = next.findIndex((item) => item.agentId === agentId);
        if (index === -1) {
          if (delta > 0) next.push({ agentId, workerCount: 1 });
        } else {
          const count = next[index].workerCount + delta;
          if (count <= 0) next.splice(index, 1);
          else next[index] = { ...next[index], workerCount: count };
        }
        applySwarmUpdate({ modelAllocations: next });
        return next;
      });
    }
  };
}

export type TaskParametersDropdownController = ReturnType<typeof useTaskParametersDropdown>;

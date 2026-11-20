import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeAgentSwarmSettings } from "@meowbert/shared/agent-swarm-config";
import type { ApiClient } from "../../../lib/api";
import type {
  TaskDetail,
  TaskMessage,
  TaskParameters,
  TaskToolOptions,
  TaskWorkflowComposerConfig,
  UserProfile
} from "../../../lib/types";
import { useFileUpload } from "../../../hooks/useFileUpload";
import {
  getTaskInputDraftForProject,
  normalizeToolOptions,
  readTaskInputDrafts,
  updateTaskInputDraftForProject,
  writeTaskInputDrafts,
  type TaskInputDraft
} from "../../../task/taskInputDrafts";
import { canSelectTaskModel, getTaskMessageAgentId } from "../../../task/taskModelSelection";
import { readLatestTaskMessageSetup, readTaskMessageSetup } from "../../../task/taskMessageSetup";
import { buildTaskParametersFromTask } from "../../../task/taskParameters";
import {
  buildTaskInputAttachmentPath,
  buildTaskInputsDestinationPath
} from "../../../task/taskFileDestinations";
import {
  readCurrentTaskConversationDraft,
  useTaskConversationDraftPersistence
} from "./useTaskConversationDraftPersistence";

interface AgentSummary {
  id: string;
}

export function buildWorkflowComposerConfigFromTaskDetail(
  taskDetail: TaskDetail | null
): TaskWorkflowComposerConfig {
  const workflow = taskDetail?.workflow;
  const taskType = taskDetail?.task.task_type;

  if (workflow?.type === "long_horizon") {
    const reviewMode = workflow.config?.reviewMode;
    const researchMode = workflow.config?.researchMode;
    return {
      type: reviewMode === "quality_control"
        ? "quality_control"
        : researchMode === "deep_research"
          ? "deep_research"
          : "long_horizon",
      tokenBudget: typeof workflow.config?.tokenBudget === "number" ? workflow.config.tokenBudget : null,
      timeBudgetMinutes: typeof workflow.config?.timeBudgetMinutes === "number" ? workflow.config.timeBudgetMinutes : null,
      enableClarifyPhase: workflow.config?.enableClarifyPhase !== false,
      enableReviewPhase: workflow.config?.enableReviewPhase !== false
    };
  }

  if (workflow?.type === "agent_swarm") {
    const settings = normalizeAgentSwarmSettings(workflow.config);
    return {
      type: "agent_swarm",
      routerId: settings.routerId,
      spawnEffort: settings.spawnEffort,
      budgetsEnabled: settings.budgetsEnabled,
      tokenBudget: settings.tokenBudget,
      timeBudgetMinutes: settings.timeBudgetMinutes,
      advanced: settings.advanced
    };
  }

  return {
    type: taskType === "long_horizon" || taskType === "agent_swarm" ? taskType : "standard",
    tokenBudget: null,
    timeBudgetMinutes: null,
    enableClarifyPhase: true,
    enableReviewPhase: true
  };
}

interface UseTaskDetailComposerInput {
  api: ApiClient;
  taskId: string;
  taskProjectId: string | null;
  taskRootPath: string | null;
  taskDetail: TaskDetail | null;
  workspaceMemoryEnabled: boolean;
  user: UserProfile | null;
  availableAgents: AgentSummary[];
  defaultAgentId: string | null;
}

function useTaskComposerDraftState(input: UseTaskDetailComposerInput) {
  const initialDraft = useMemo(() => readCurrentTaskConversationDraft(input.taskId), [input.taskId]);
  const [followUp, setFollowUp] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [draftsByProject, setDraftsByProject] = useState<Record<string, TaskInputDraft>>(() => readTaskInputDrafts());
  const draftDefaults = useMemo(() => ({ memorySearch: input.workspaceMemoryEnabled }), [input.workspaceMemoryEnabled]);
  // A follow-up starts from the task's own latest message, so every device offers what the task last
  // ran with. Changes made here last until a new message is sent.
  const latestSetup = useMemo(() => {
    const message = input.taskDetail?.latest_user_message;
    if (message !== undefined) return message ? readTaskMessageSetup(message) : null;
    return readLatestTaskMessageSetup(input.taskDetail?.messages ?? []);
  }, [input.taskDetail?.latest_user_message, input.taskDetail?.messages]);
  const setupKey = `${input.taskId}:${latestSetup?.messageId ?? ""}`;
  const [changes, setChanges] = useState<{ key: string; toolOptions?: TaskToolOptions; agentId?: string | null }>({ key: setupKey });
  const currentChanges = changes.key === setupKey ? changes : { key: setupKey };
  const toolOptions = useMemo<TaskToolOptions>(() => {
    const options = currentChanges.toolOptions
      ?? latestSetup?.toolOptions
      ?? getTaskInputDraftForProject(draftsByProject, input.taskProjectId, draftDefaults).toolOptions;
    return {
      ...options,
      memorySearch: input.workspaceMemoryEnabled ? options.memorySearch : false
    };
  }, [currentChanges.toolOptions, draftDefaults, draftsByProject, input.taskProjectId, input.workspaceMemoryEnabled, latestSetup]);
  const taskParameters = useMemo<TaskParameters>(() => buildTaskParametersFromTask({
    taskType: input.taskDetail?.task.task_type,
    maxStepsOverride: input.taskDetail?.task.max_steps_override ?? null,
    timeLimitSeconds: input.taskDetail?.task.time_limit_seconds ?? null,
    allowWaiting: input.taskDetail?.task.allow_waiting,
    schedule: input.taskDetail?.task.schedule ?? null
  }), [
    input.taskDetail?.task.allow_waiting,
    input.taskDetail?.task.max_steps_override,
    input.taskDetail?.task.schedule,
    input.taskDetail?.task.task_type,
    input.taskDetail?.task.time_limit_seconds
  ]);
  const workflowConfig = useMemo<TaskWorkflowComposerConfig>(
    () => buildWorkflowComposerConfigFromTaskDetail(input.taskDetail),
    [input.taskDetail?.task.task_type, input.taskDetail?.workflow]
  );
  const persistedThreadAgentId = input.taskDetail?.task.is_thread === true
    ? input.taskDetail.task.thread_agent_id ?? null
    : null;
  const [selectedThreadAgentId, setSelectedThreadAgentId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedThreadAgentId(persistedThreadAgentId);
  }, [input.taskId, persistedThreadAgentId]);
  const selectedAgentId = useMemo(() => {
    if (!canSelectTaskModel(input.user)) return null;
    if (editingMessageId) return editingAgentId;
    if (input.availableAgents.length === 0) return null;
    if (
      selectedThreadAgentId
      && input.taskDetail?.task.is_thread === true
      && input.availableAgents.some((agent) => agent.id === selectedThreadAgentId)
    ) {
      return selectedThreadAgentId;
    }
    const isAvailable = (agentId: string | null | undefined): agentId is string =>
      typeof agentId === "string" && input.availableAgents.some((agent) => agent.id === agentId);
    if (currentChanges.agentId !== undefined && isAvailable(currentChanges.agentId)) return currentChanges.agentId;
    if (isAvailable(latestSetup?.agentId)) return latestSetup.agentId;
    const draftAgentId = getTaskInputDraftForProject(draftsByProject, input.taskProjectId).agentId;
    if (!latestSetup && isAvailable(draftAgentId)) return draftAgentId;
    if (input.defaultAgentId && input.availableAgents.some((agent) => agent.id === input.defaultAgentId)) return input.defaultAgentId;
    return input.availableAgents[0]?.id ?? null;
  }, [
    currentChanges.agentId,
    draftsByProject,
    editingAgentId,
    editingMessageId,
    input.availableAgents,
    input.defaultAgentId,
    input.taskDetail?.task.is_thread,
    input.taskProjectId,
    input.user,
    latestSetup,
    selectedThreadAgentId
  ]);

  const selectedMasterTaskAgentId = useMemo(() => {
    if (input.taskDetail?.task.is_project_master !== true || !canSelectTaskModel(input.user)) return null;
    const draftId = getTaskInputDraftForProject(draftsByProject, input.taskProjectId).masterTaskAgentId;
    return draftId && input.availableAgents.some((agent) => agent.id === draftId) ? draftId : null;
  }, [draftsByProject, input.availableAgents, input.taskDetail?.task.is_project_master, input.taskProjectId, input.user]);

  const handleMasterTaskAgentChange = useCallback((agentId: string | null) => {
    setDraftsByProject((current) => updateTaskInputDraftForProject(current, input.taskProjectId, (draft) => ({
      ...draft,
      masterTaskAgentId: agentId
    }), draftDefaults));
  }, [draftDefaults, input.taskProjectId]);

  const handleToolOptionsChange = useCallback((next: TaskToolOptions) => {
    setChanges((current) => ({
      ...(current.key === setupKey ? current : { key: setupKey }),
      toolOptions: normalizeToolOptions(next, draftDefaults)
    }));
  }, [draftDefaults, setupKey]);

  const handleAgentChange = useCallback((agentId: string | null) => {
    if (editingMessageId) {
      setEditingAgentId(agentId);
      return;
    }
    if (input.taskDetail?.task.is_thread === true) {
      setSelectedThreadAgentId(agentId);
      return;
    }

    setChanges((current) => ({ ...(current.key === setupKey ? current : { key: setupKey }), agentId }));
  }, [editingMessageId, input.taskDetail?.task.is_thread, setupKey]);

  const beginEditMessage = useCallback((message: TaskMessage) => {
    setEditingAgentId(getTaskMessageAgentId(message));
    setEditingMessageId(message.id);
  }, []);

  useEffect(() => writeTaskInputDrafts(draftsByProject), [draftsByProject]);
  useEffect(() => setEditingMessageId(null), [input.taskId]);
  return {
    initialDraft,
    followUp,
    setFollowUp,
    editingMessageId,
    setEditingMessageId,
    beginEditMessage,
    draftsByProject,
    setDraftsByProject,
    draftDefaults,
    toolOptions,
    latestSetup,
    taskParameters,
    workflowConfig,
    selectedAgentId,
    selectedMasterTaskAgentId,
    handleToolOptionsChange,
    handleAgentChange,
    handleMasterTaskAgentChange
  };
}

export function useTaskDetailComposer(input: UseTaskDetailComposerInput) {
  const draft = useTaskComposerDraftState(input);
  const uploadPath = useMemo(() => buildTaskInputsDestinationPath(input.taskRootPath), [input.taskRootPath]);
  const toAttachmentPath = useCallback((uploaded: { relativePath: string; name: string }) => (
    buildTaskInputAttachmentPath(uploadPath, uploaded.relativePath, uploaded.name)
  ), [uploadPath]);
  const uploads = useFileUpload(input.api, input.taskProjectId, {
    destinationPath: uploadPath,
    createDirectories: true,
    toAttachmentPath,
    initialAttachments: draft.initialDraft.attachments
  });
  const persistence = useTaskConversationDraftPersistence({
    taskId: input.taskId,
    followUp: draft.followUp,
    setFollowUp: draft.setFollowUp,
    attachments: uploads.attachments,
    editingMessageId: draft.editingMessageId
  });
  const cancelEditMessage = useCallback(() => {
    const saved = readCurrentTaskConversationDraft(input.taskId);
    draft.setEditingMessageId(null);
    draft.setFollowUp(saved.message);
    uploads.setAttachments(saved.attachments);
  }, [input.taskId, draft.setEditingMessageId, draft.setFollowUp, uploads.setAttachments]);
  return { ...draft, ...uploads, ...persistence, cancelEditMessage, uploadPath, toAttachmentPath };
}

export type TaskDetailComposer = ReturnType<typeof useTaskDetailComposer>;

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type {
  FlashMessage,
  Project,
  ProjectCanvasSummary,
  TaskAssistantMessageDisplayPreferences,
  TaskAttachment,
  TaskDetail,
  TaskParameters,
  TaskToolOptions,
  TaskWorkflowComposerConfig
} from "../../../lib/types";
import type { ApiClient } from "../../../lib/api";
import type { PlatformAdapter, PlatformCapabilities, ServerProfile } from "../../../desktop/platform";
import type { SelectedTextQuote, MessageSelectedTextQuote } from "../../../components/taskConversation/selectedTextQuoteUtils";
import { buildSelectedTextMessage } from "../../../components/taskConversation/selectedTextQuoteUtils";
import { buildTaskArtifactDownloadPath } from "../../../task/taskFileDestinations";
import { buildTaskChatExport, fetchTaskChatExportMessages, type TaskChatExportFormat } from "../../../task/taskChatExport";
import { buildDownloadUrl } from "../../../lib/utils";
import { triggerAuthenticatedBrowserDownload } from "../../../lib/authenticated-download";
import { downloadTextFile } from "./downloadTextFile";
import {
  compactTaskContext,
  requestTaskInterrupt,
  runTaskScheduleAction,
  sendTaskFollowUp,
  updateTaskParameters,
  type TaskScheduleAction
} from "./taskDetailMutations";
import { buildDefaultTaskParameters, taskScheduleMatches } from "../../../task/taskParameters";

interface UseTaskDetailActionsInput {
  api: ApiClient;
  token: string;
  taskId: string;
  taskWorkspaceId: string | null;
  taskProjectId: string | null;
  taskRootPath: string | null;
  taskDetail: TaskDetail | null;
  setTaskDetail: Dispatch<SetStateAction<TaskDetail | null>>;
  activeLeafMessageId: string | null;
  setActiveLeafMessageId: Dispatch<SetStateAction<string | null>>;
  loadTask: () => Promise<void>;
  invalidateCurrentTaskCache: () => void;
  refreshTasks: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  setFlash: (flash: FlashMessage | null) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  navigate: NavigateFunction;
  platform: PlatformAdapter;
  capabilities: PlatformCapabilities;
  activeServerProfile: ServerProfile | null;
  activeProject: Project | null | undefined;
  followUp: string;
  setFollowUp: Dispatch<SetStateAction<string>>;
  attachments: TaskAttachment[];
  clearAttachments: () => void;
  editingMessageId: string | null;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  quotedFollowUpSelections: SelectedTextQuote[];
  setQuotedFollowUpSelections: Dispatch<SetStateAction<SelectedTextQuote[]>>;
  setSelectedTextDraft: Dispatch<SetStateAction<MessageSelectedTextQuote | null>>;
  selectedFollowUpCanvas: ProjectCanvasSummary | null;
  setSelectedFollowUpCanvas: Dispatch<SetStateAction<ProjectCanvasSummary | null>>;
  toolOptions: TaskToolOptions;
  taskParameters: TaskParameters;
  workspaceMemoryEnabled: boolean;
  selectedAgentId: string | null;
  cancelPendingConversationDraftPersist: () => void;
  clearCurrentConversationDraft: () => void;
  persistedMessageDisplayPreferences: TaskAssistantMessageDisplayPreferences;
}

function useTaskInterruptActions(input: UseTaskDetailActionsInput) {
  const [isCompacting, setIsCompacting] = useState(false);
  const [isClearingContext, setIsClearingContext] = useState(false);
  const [isScheduleActionBusy, setIsScheduleActionBusy] = useState(false);

  async function requestInterruptAndMarkTask(): Promise<void> {
    if (!input.taskId) return;
    await requestTaskInterrupt(input.api, input.taskId);
    input.setTaskDetail((current) => current ? {
      ...current,
      task: { ...current.task, cancellation_requested: true }
    } : current);
  }

  async function handleCancelTask(): Promise<void> {
    if (!input.taskId) return;
    try {
      input.setError(null);
      await requestInterruptAndMarkTask();
      input.invalidateCurrentTaskCache();
    } catch (error) {
      input.setError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCompactContext(): Promise<void> {
    if (!input.taskId) return;
    input.setError(null);
    setIsCompacting(true);
    try {
      await compactTaskContext(input.api, input.taskId);
      input.invalidateCurrentTaskCache();
      await input.loadTask();
    } catch (error) {
      input.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCompacting(false);
    }
  }

  async function handleClearContext(): Promise<void> {
    if (!input.taskId) return;
    input.setError(null);
    setIsClearingContext(true);
    try {
      await compactTaskContext(input.api, input.taskId, "clear");
      input.invalidateCurrentTaskCache();
      await input.loadTask();
    } catch (error) {
      input.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsClearingContext(false);
    }
  }

  async function runScheduleAction(action: TaskScheduleAction, successMessage: string): Promise<void> {
    if (!input.taskId) return;
    setIsScheduleActionBusy(true);
    input.setError(null);
    try {
      const response = await runTaskScheduleAction(input.api, input.taskId, action);
      input.invalidateCurrentTaskCache();
      await input.loadTask();
      input.setFlash({
        tone: "success",
        text: response.mode === "pending"
          ? `${successMessage} A run is already active, so the next recurring run is queued as pending.`
          : successMessage
      });
    } catch (error) {
      input.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsScheduleActionBusy(false);
    }
  }

  return {
    isCompacting,
    isClearingContext,
    isScheduleActionBusy,
    requestInterruptAndMarkTask,
    handleCancelTask,
    handleCompactContext,
    handleClearContext,
    runScheduleAction
  };
}

function useTaskFollowUpAction(
  input: UseTaskDetailActionsInput,
  requestInterruptAndMarkTask: () => Promise<void>
) {
  const [isBusy, setIsBusy] = useState(false);

  async function handleSendFollowUp(): Promise<void> {
    const message = input.quotedFollowUpSelections.length > 0
      ? buildSelectedTextMessage(input.quotedFollowUpSelections, input.followUp)
      : input.followUp;
    if ((!message.trim() && input.attachments.length === 0) || !input.taskId || !input.taskDetail) return;

    setIsBusy(true);
    input.setError(null);
    try {
      if (["running", "starting", "queued"].includes(input.taskDetail.task.status)) {
        await requestInterruptAndMarkTask();
      }
      const response = await sendTaskFollowUp({
        api: input.api,
        taskId: input.taskId,
        followUp: message,
        attachments: input.attachments,
        editingMessageId: input.editingMessageId,
        toolOptions: input.toolOptions,
        workspaceMemoryEnabled: input.workspaceMemoryEnabled,
        allowComputerUse: input.capabilities.isDesktop,
        selectedAgentId: input.selectedAgentId,
        interactiveCanvasId: input.taskDetail.task.interactive_canvas_id ?? input.selectedFollowUpCanvas?.id ?? null,
        interactiveCanvasIntent: input.taskDetail.task.interactive_canvas_id || input.selectedFollowUpCanvas ? "update" : null
      });
      input.invalidateCurrentTaskCache();
      input.cancelPendingConversationDraftPersist();
      input.setFollowUp("");
      input.setSelectedTextDraft(null);
      input.setQuotedFollowUpSelections([]);
      input.clearAttachments();
      input.setSelectedFollowUpCanvas(null);
      input.clearCurrentConversationDraft();
      input.setEditingMessageId(null);
      if (typeof response.activeLeafMessageId === "string") input.setActiveLeafMessageId(response.activeLeafMessageId);
      if (response.mode === "interrupting") {
        input.setTaskDetail((current) => current ? {
          ...current,
          task: { ...current.task, cancellation_requested: true, resume_after_interrupt: true }
        } : current);
      }
      await input.loadTask();
    } catch (error) {
      input.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  return { isBusy, handleSendFollowUp };
}

function useTaskParameterAction(input: UseTaskDetailActionsInput) {
  async function handleTaskParametersChange(next: TaskParameters): Promise<void> {
    if (!input.taskId) return;
    const scheduleChanged = !taskScheduleMatches(input.taskParameters.schedule, next.schedule);
    const shouldSeedTools = input.taskParameters.schedule.type === "standard" && next.schedule.type !== "standard";
    const updated = await updateTaskParameters(input.api, input.taskId, {
      maxSteps: next.maxSteps,
      timeLimitSeconds: next.timeLimitSeconds,
      allowWaiting: next.allowWaiting,
      ...(scheduleChanged ? { schedule: next.schedule } : {}),
      ...(shouldSeedTools ? { tools: input.toolOptions } : {})
    });
    input.invalidateCurrentTaskCache();
    input.setTaskDetail((current) => current ? {
      ...current,
      task: {
        ...current.task,
        max_steps_override: updated.max_steps_override,
        time_limit_seconds: updated.time_limit_seconds,
        allow_waiting: updated.allow_waiting,
        default_timezone: updated.default_timezone,
        task_type: updated.task_type,
        schedule: updated.schedule
      },
      workflow: updated.workflow
    } : current);
  }

  async function handleWorkflowChange(nextWorkflow: TaskWorkflowComposerConfig): Promise<void> {
    if (!input.taskId) return;
    const shouldClearSchedule = nextWorkflow.type === "standard"
      && input.taskParameters.schedule.type !== "standard";
    const updated = await updateTaskParameters(input.api, input.taskId, {
      maxSteps: input.taskParameters.maxSteps,
      timeLimitSeconds: input.taskParameters.timeLimitSeconds,
      allowWaiting: input.taskParameters.allowWaiting,
      ...(shouldClearSchedule ? { schedule: buildDefaultTaskParameters().schedule } : {}),
      workflow: nextWorkflow
    });
    input.invalidateCurrentTaskCache();
    input.setTaskDetail((current) => current ? {
      ...current,
      task: {
        ...current.task,
        max_steps_override: updated.max_steps_override,
        time_limit_seconds: updated.time_limit_seconds,
        allow_waiting: updated.allow_waiting,
        default_timezone: updated.default_timezone,
        task_type: updated.task_type,
        schedule: updated.schedule
      },
      workflow: updated.workflow
    } : current);
  }

  return { handleTaskParametersChange, handleWorkflowChange };
}

function useTaskDisplayPreferences(input: UseTaskDetailActionsInput) {
  const [messageDisplayPreferences, setMessageDisplayPreferences] = useState(input.persistedMessageDisplayPreferences);
  const [isMessageDisplayPreferencesSaving, setIsMessageDisplayPreferencesSaving] = useState(false);
  useEffect(() => setMessageDisplayPreferences(input.persistedMessageDisplayPreferences), [input.persistedMessageDisplayPreferences]);

  async function handleMessageDisplayPreferencesChange(next: TaskAssistantMessageDisplayPreferences): Promise<void> {
    const previous = messageDisplayPreferences;
    setMessageDisplayPreferences(next);
    setIsMessageDisplayPreferencesSaving(true);
    try {
      await input.api.patch("/api/auth/preferences", {
        taskPagePreferences: { assistantMessageDisplay: next }
      });
      try {
        await input.refreshWorkspaces();
      } catch (error) {
        console.error(error);
      }
    } catch (error) {
      setMessageDisplayPreferences(previous);
      input.setFlash({ tone: "error", text: error instanceof Error ? error.message : "Failed to save display settings." });
    } finally {
      setIsMessageDisplayPreferencesSaving(false);
    }
  }

  return { messageDisplayPreferences, isMessageDisplayPreferencesSaving, handleMessageDisplayPreferencesChange };
}

function useTaskExportAndDownloadActions(input: UseTaskDetailActionsInput) {
  const [isExportingChat, setIsExportingChat] = useState(false);
  const [isDownloadingArtifact, setIsDownloadingArtifact] = useState(false);

  async function handleExportChat(format: TaskChatExportFormat): Promise<void> {
    if (!input.taskId || !input.taskDetail || isExportingChat) return;
    setIsExportingChat(true);
    try {
      const conversation = await fetchTaskChatExportMessages({
        api: input.api,
        taskId: input.taskId,
        activeLeafMessageId: input.activeLeafMessageId ?? input.taskDetail.active_leaf_message_id ?? null
      });
      const file = buildTaskChatExport({
        task: input.taskDetail.task,
        activeLeafMessageId: conversation.activeLeafMessageId,
        messages: conversation.messages,
        exportedAt: new Date().toISOString(),
        format
      });
      downloadTextFile(file);
      input.setFlash({ tone: "success", text: `Exported ${file.messageCount} message${file.messageCount === 1 ? "" : "s"}.` });
    } catch (error) {
      input.setFlash({ tone: "error", text: error instanceof Error ? error.message : "Failed to export chat." });
    } finally {
      setIsExportingChat(false);
    }
  }

  async function handleDownloadArtifact(relativePath: string): Promise<void> {
    if (!input.taskProjectId || isDownloadingArtifact) return;
    setIsDownloadingArtifact(true);
    try {
      const downloadPath = buildTaskArtifactDownloadPath(input.taskRootPath, relativePath) ?? relativePath;
      const url = buildDownloadUrl(input.taskProjectId, downloadPath);
      if (input.capabilities.supportsNativeDownloads) {
        const result = await input.platform.saveUrlToFile({
          url,
          token: input.token,
          suggestedFilename: relativePath.split("/").pop() ?? "artifact"
        });
        if (!result.canceled) input.setFlash({ tone: "success", text: "Artifact saved." });
        return;
      }
      await triggerAuthenticatedBrowserDownload({
        url,
        token: input.token,
        suggestedFilename: relativePath.split("/").pop() ?? "artifact"
      });
    } catch (error) {
      input.setFlash({ tone: "error", text: error instanceof Error ? error.message : "Failed to download artifact." });
    } finally {
      setIsDownloadingArtifact(false);
    }
  }

  return { isExportingChat, handleExportChat, isDownloadingArtifact, handleDownloadArtifact };
}

function useTaskNavigationActions(input: UseTaskDetailActionsInput) {
  const [isDeletingPermanently, setIsDeletingPermanently] = useState(false);

  async function handleDeletePermanently(): Promise<void> {
    if (!input.taskId || !input.taskWorkspaceId || !input.taskProjectId) return;
    if (!window.confirm("Delete this incognito chat permanently? This cannot be undone.")) return;
    setIsDeletingPermanently(true);
    input.setError(null);
    try {
      await input.api.delete(`/api/tasks/${input.taskId}`);
      input.api.invalidateGet?.({ pathPrefix: `/api/tasks/${input.taskId}` });
      input.api.invalidateGet?.({ pathPrefix: `/api/projects/${input.taskProjectId}/tasks` });
      await input.refreshTasks();
      input.navigate(`/app/${input.taskWorkspaceId}/projects/${input.taskProjectId}`);
    } catch (error) {
      input.setError(error instanceof Error ? error.message : String(error));
      setIsDeletingPermanently(false);
    }
  }

  function handleViewFiles(): void {
    if (!input.taskProjectId || !input.taskWorkspaceId || !input.taskRootPath) return;
    input.navigate(`/app/${input.taskWorkspaceId}/projects/${input.taskProjectId}/files?path=${encodeURIComponent(input.taskRootPath)}`);
  }

  async function handleOpenTaskFolder(): Promise<void> {
    if (!input.capabilities.supportsRevealPath || input.activeServerProfile?.mode !== "local") {
      input.setFlash({ tone: "error", text: "Open folder is available only in local desktop mode." });
      return;
    }
    if (!input.taskRootPath) {
      input.setFlash({ tone: "error", text: "Task folder is not available yet." });
      return;
    }
    const isAbsolute = input.taskRootPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(input.taskRootPath);
    const revealInput = isAbsolute
      ? { absolutePath: input.taskRootPath }
      : input.activeProject?.root_path ? { rootPath: input.activeProject.root_path, relativePath: input.taskRootPath } : null;
    if (!revealInput) {
      input.setFlash({ tone: "error", text: "Project path is not available yet." });
      return;
    }
    const result = await input.platform.revealPath(revealInput);
    if (!result.ok) input.setFlash({ tone: "error", text: result.error ?? "Unable to open task folder." });
  }

  return { isDeletingPermanently, handleDeletePermanently, handleViewFiles, handleOpenTaskFolder };
}

export function useTaskDetailActions(input: UseTaskDetailActionsInput) {
  const interruption = useTaskInterruptActions(input);
  return {
    ...interruption,
    ...useTaskFollowUpAction(input, interruption.requestInterruptAndMarkTask),
    ...useTaskParameterAction(input),
    ...useTaskDisplayPreferences(input),
    ...useTaskExportAndDownloadActions(input),
    ...useTaskNavigationActions(input)
  };
}

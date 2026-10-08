import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EyeOff, Zap } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { ChatInput } from "../../components/taskConversation/ChatInput";
import { EnvironmentFilePickerModal } from "../../components/modals/EnvironmentFilePickerModal";
import { CanvasPickerModal } from "../../components/modals/CanvasPickerModal";
import { SourceFilePickerModal } from "../../components/modals/SourceFilePickerModal";
import { useFileUpload } from "../../hooks/useFileUpload";
import { useTaskInputCatalog } from "../../hooks/useTaskInputCatalog";
import { buildDefaultTaskParameters } from "../../task/taskParameters";
import { buildCreateTaskParametersPayload, buildCreateTaskSchedulePayload } from "../../task/taskParameters";
import { buildTaskInputAttachmentPath } from "../../task/taskFileDestinations";
import { getTaskUiPreferencesForUser } from "../../task/taskPagePreferences";
import { SuggestedActionPills } from "../../project/suggestedActions/SuggestedActionPills";
import { useProjectSuggestedActions } from "../../project/suggestedActions/useProjectSuggestedActions";
import type { ProjectCanvasResponse, ProjectCanvasSummary, TaskAttachment } from "../../lib/types";
import { joinTaskMessage } from "../../lib/utils";
import {
  TaskInputDraft,
  getTaskInputDraftForEnvironment,
  normalizeInteractiveCanvasToolOptions,
  normalizeToolOptions,
  readTaskInputDrafts,
  shouldRotateRestoredComposerTaskId,
  updateTaskInputDraftForEnvironment,
  writeTaskInputDrafts
} from "../../task/taskInputDrafts";
import { canSelectTaskModel } from "../../task/taskModelSelection";
import { resolveWorkflowForAgentChange } from "../../task/agentSwarmPresetWorkflow";
import type { WorkspaceSourceSummary } from "../../sources/sourceTypes";
import { useSubscriptionUsageWarning } from "../../subscription/usageLimits";

function createPendingTaskId(): string {
  return crypto.randomUUID();
}

function haveMatchingAttachments(left: TaskAttachment[], right: TaskAttachment[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((attachment, index) => {
    const other = right[index];
    return other
      && attachment.id === other.id
      && attachment.kind === other.kind
      && attachment.label === other.label
      && attachment.content === other.content
      && attachment.relativePath === other.relativePath
      && attachment.sizeBytes === other.sizeBytes
      && attachment.forceInclude === other.forceInclude;
  });
}

function buildCanvasAttachment(canvas: ProjectCanvasSummary): TaskAttachment {
  return {
    id: crypto.randomUUID(),
    kind: "canvas",
    label: canvas.name,
    content: `Canvas: ${canvas.name}`,
    relativePath: canvas.rootPath
  };
}

export function TaskComposerPage() {
  const { api, user, activeWorkspaceId, activeEnvironmentId, environments, workspaceSettings, refreshTasks } = useWorkspaceApp();
  const { capabilities } = useAppRuntime();
  const navigate = useNavigate();
  const location = useLocation();
  const canvasSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialCanvasMode = canvasSearchParams.get("canvasMode") === "1";
  const queryCanvasId = canvasSearchParams.get("canvasId");
  const [draftsByEnvironment, setDraftsByEnvironment] = useState<Record<string, TaskInputDraft>>(() => readTaskInputDrafts());
  const rotatedRestoredComposerProjects = useRef<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEnvironmentFilePickerOpen, setIsEnvironmentFilePickerOpen] = useState(false);
  const [isCanvasPickerOpen, setIsCanvasPickerOpen] = useState(false);
  const [selectedInteractiveCanvas, setSelectedInteractiveCanvas] = useState<ProjectCanvasSummary | null>(null);
  const [selectedSource, setSelectedSource] = useState<WorkspaceSourceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incognitoMode, setIncognitoMode] = useState(false);
  const subscriptionUsageWarning = useSubscriptionUsageWarning();
  const {
    availableSkills,
    availableAgents,
    availableSources,
    attachableSources,
    defaultAgentId,
    modelSliderAgentIds
  } = useTaskInputCatalog(api, activeWorkspaceId, user?.is_super_admin === true);
  const workspaceMemoryEnabled = workspaceSettings?.memoryEnabled === true;
  const draftDefaults = useMemo(
    () => ({ memorySearch: workspaceMemoryEnabled, defaultToolset: workspaceSettings?.defaultToolset ?? null }),
    [workspaceMemoryEnabled, workspaceSettings?.defaultToolset]
  );
  const currentDraft = useMemo<TaskInputDraft>(
    () => getTaskInputDraftForEnvironment(draftsByEnvironment, activeEnvironmentId, draftDefaults),
    [activeEnvironmentId, draftDefaults, draftsByEnvironment]
  );
  const pendingTaskId = currentDraft.composerTaskId;

  const updateDraft = useCallback((updater: (current: TaskInputDraft) => TaskInputDraft) => {
    if (!activeEnvironmentId) {
      return;
    }

    setDraftsByEnvironment((current) =>
      updateTaskInputDraftForEnvironment(current, activeEnvironmentId, updater, draftDefaults)
    );
  }, [activeEnvironmentId, draftDefaults]);

  useEffect(() => {
    if (!activeEnvironmentId) {
      return;
    }

    if (
      shouldRotateRestoredComposerTaskId(currentDraft)
      && !rotatedRestoredComposerProjects.current.has(activeEnvironmentId)
    ) {
      rotatedRestoredComposerProjects.current.add(activeEnvironmentId);
      updateDraft((draft) => ({
        ...draft,
        composerTaskId: createPendingTaskId()
      }));
      return;
    }

    if (currentDraft.composerTaskId) {
      return;
    }

    rotatedRestoredComposerProjects.current.add(activeEnvironmentId);
    updateDraft((draft) => ({
      ...draft,
      composerTaskId: createPendingTaskId()
    }));
  }, [activeEnvironmentId, currentDraft, updateDraft]);

  const taskInputUploadPath = useMemo(() => {
    if (!activeEnvironmentId || !pendingTaskId) {
      return null;
    }

    return `.meowbert/task-runs/${pendingTaskId}/inputs`;
  }, [activeEnvironmentId, pendingTaskId]);

  const {
    attachments,
    uploadFiles,
    removeAttachment,
    toggleAttachmentForceInclude,
    isUploading,
    pendingUploads,
    uploadError,
    appendAttachments
  } = useFileUpload(api, activeEnvironmentId, {
    destinationPath: taskInputUploadPath,
    createDirectories: true,
    toAttachmentPath: (uploaded) => buildTaskInputAttachmentPath(taskInputUploadPath, uploaded.relativePath, uploaded.name),
    initialAttachments: currentDraft.attachments
  });

  const taskUiPreferences = useMemo(() => getTaskUiPreferencesForUser(user), [user?.task_page_preferences]);

  const prompt = currentDraft.prompt;
  const toolOptions = useMemo(
    () => ({
      ...currentDraft.toolOptions,
      memorySearch: workspaceMemoryEnabled ? currentDraft.toolOptions.memorySearch : false
    }),
    [currentDraft.toolOptions, workspaceMemoryEnabled]
  );
  const selectedAgentId = useMemo(() => {
    if (!canSelectTaskModel(user) || availableAgents.length === 0) {
      return null;
    }

    const hasDraftSelection = typeof currentDraft.agentId === "string"
      && availableAgents.some((agent) => agent.id === currentDraft.agentId);
    if (hasDraftSelection) {
      return currentDraft.agentId;
    }

    if (typeof defaultAgentId === "string" && availableAgents.some((agent) => agent.id === defaultAgentId)) {
      return defaultAgentId;
    }

    return availableAgents[0]?.id ?? null;
  }, [availableAgents, currentDraft.agentId, defaultAgentId, user]);
  const taskParameters = currentDraft.taskParameters;
  const workflow = currentDraft.workflow;
  const isInteractiveCanvasEnabled = currentDraft.toolOptions.interactiveCanvas === true || selectedInteractiveCanvas !== null;
  const quickMode = currentDraft.quickMode && workflow.type === "standard";
  const effectiveQuickMode = quickMode && !isInteractiveCanvasEnabled;
  const effectiveIncognitoMode = incognitoMode && workflow.type === "standard" && !isInteractiveCanvasEnabled;

  useEffect(() => {
    writeTaskInputDrafts(draftsByEnvironment);
  }, [draftsByEnvironment]);

  useEffect(() => {
    if (workflow.type !== "standard" || isInteractiveCanvasEnabled) {
      setIncognitoMode(false);
    }
  }, [isInteractiveCanvasEnabled, workflow.type]);

  useEffect(() => {
    if (!initialCanvasMode || queryCanvasId) {
      return;
    }

    updateDraft((current) => (
      current.toolOptions.interactiveCanvas === true
        ? current
        : {
          ...current,
          quickMode: false,
          toolOptions: {
            ...current.toolOptions,
            interactiveCanvas: true
          }
        }
    ));
  }, [initialCanvasMode, queryCanvasId, updateDraft]);

  useEffect(() => {
    if (!initialCanvasMode || !queryCanvasId || !activeEnvironmentId) {
      return;
    }

    let cancelled = false;
    api.get<ProjectCanvasResponse>(`/api/projects/${activeEnvironmentId}/canvases/${queryCanvasId}`)
      .then((response) => {
        if (!cancelled) {
          setSelectedInteractiveCanvas(response.canvas);
          updateDraft((current) => ({
            ...current,
            quickMode: false,
            toolOptions: {
              ...current.toolOptions,
              interactiveCanvas: true
            }
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedInteractiveCanvas(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeEnvironmentId, api, initialCanvasMode, queryCanvasId, updateDraft]);

  const suggestedActions = useProjectSuggestedActions(api, activeWorkspaceId, activeEnvironmentId);

  useEffect(() => {
    if (!activeEnvironmentId) {
      return;
    }

    updateDraft((draft) => (
      haveMatchingAttachments(draft.attachments, attachments)
        ? draft
        : {
          ...draft,
          attachments
        }
    ));
  }, [activeEnvironmentId, attachments, updateDraft]);

  if (!activeEnvironmentId) {
    return (
      <section className="page-content">
        <article className="section-card empty-card">
          <h3>No project selected</h3>
          <p>Choose a project before creating a task.</p>
        </article>
      </section>
    );
  }

  async function submitTask() {
    if ((!prompt.trim() && attachments.length === 0) || !activeEnvironmentId || !pendingTaskId) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const toolsPayload: Record<string, unknown> = {};
      if (toolOptions.webSearch) toolsPayload.webSearch = true;
      if (workspaceMemoryEnabled && toolOptions.memorySearch) toolsPayload.memorySearch = true;
      if (toolOptions.scheduleTask) toolsPayload.scheduleTask = true;
      if (toolOptions.subtasks) toolsPayload.subtasks = true;
      if (capabilities.isDesktop && toolOptions.computerUse) toolsPayload.computerUse = true;
      if (isInteractiveCanvasEnabled) toolsPayload.interactiveCanvas = true;
      if (toolOptions.enabledSkills.length > 0) toolsPayload.enabledSkills = toolOptions.enabledSkills;
      if (toolOptions.enabledSources.length > 0) toolsPayload.enabledSources = toolOptions.enabledSources;
      const hasTools = Object.keys(toolsPayload).length > 0;
      const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const schedulePayload = workflow.type === "standard"
        ? buildCreateTaskSchedulePayload(taskParameters)
        : undefined;
      const parametersPayload = buildCreateTaskParametersPayload(taskParameters);

      const canvasForTask = selectedInteractiveCanvas;
      const canvasAttachment = canvasForTask ? buildCanvasAttachment(canvasForTask) : null;
      const taskAttachments = canvasAttachment && !attachments.some((attachment) => attachment.kind === "canvas" && attachment.relativePath === canvasAttachment.relativePath)
        ? [...attachments, canvasAttachment]
        : attachments;

      const created = await api.post<{ taskId: string }>(`/api/projects/${activeEnvironmentId}/tasks`, {
        taskId: pendingTaskId,
        message: joinTaskMessage(prompt, taskAttachments),
        ...(effectiveQuickMode ? { quickMode: true } : {}),
        ...(effectiveIncognitoMode ? { incognito: true } : {}),
        attachments: taskAttachments,
        ...(canvasForTask
          ? {
              interactiveCanvasId: canvasForTask.id,
              interactiveCanvasIntent: selectedInteractiveCanvas ? "update" : "create"
            }
          : {}),
        ...(typeof clientTimezone === "string" && clientTimezone.length > 0 ? { clientTimezone } : {}),
        ...(hasTools ? { tools: toolsPayload } : {}),
        ...(schedulePayload ? { schedule: schedulePayload } : {}),
        ...(workflow.type !== "standard"
          ? {
            workflow: {
              type: workflow.type,
              ...(workflow.type === "agent_swarm"
                ? {
                    workerCount: workflow.workerCount,
                    reviewRounds: workflow.reviewRounds,
                    tokenBudget: workflow.tokenBudget,
                    timeBudgetMinutes: workflow.timeBudgetMinutes,
                    ...(workflow.disableSpawningAndBudgets ? { disableSpawningAndBudgets: true } : {}),
                    ...(workflow.leaderAgentId ? { leaderAgentId: workflow.leaderAgentId } : {}),
                    ...(workflow.modelAllocations.length > 0 ? { modelAllocations: workflow.modelAllocations } : {})
                  }
                : {
                    tokenBudget: workflow.tokenBudget,
                    timeBudgetMinutes: workflow.timeBudgetMinutes,
                    enableClarifyPhase: workflow.enableClarifyPhase,
                    enableReviewPhase: workflow.enableReviewPhase
                  })
            }
          }
          : {}),
        ...(parametersPayload ? { parameters: parametersPayload } : {}),
        ...(selectedAgentId ? { agent: { id: selectedAgentId } } : {})
      });

      const nextDraftsByEnvironment = updateTaskInputDraftForEnvironment(
        draftsByEnvironment,
        activeEnvironmentId,
        (draft) => ({
          ...draft,
          prompt: "",
          attachments: [],
          toolOptions: currentDraft.toolOptions.interactiveCanvas === true
            ? normalizeInteractiveCanvasToolOptions(currentDraft.toolOptions)
            : normalizeToolOptions(undefined, draftDefaults),
          composerTaskId: createPendingTaskId(),
          quickMode: false
        }),
        draftDefaults
      );
      writeTaskInputDrafts(nextDraftsByEnvironment);
      setDraftsByEnvironment(nextDraftsByEnvironment);
      setIncognitoMode(false);

      api.invalidateGet?.({ pathPrefix: `/api/projects/${activeEnvironmentId}/tasks` });
      api.invalidateGet?.({ pathPrefix: `/api/projects/${activeEnvironmentId}/canvases` });
      await refreshTasks();
      navigate(
        selectedInteractiveCanvas
          ? `/app/${activeWorkspaceId}/projects/${activeEnvironmentId}/canvases/${selectedInteractiveCanvas.id}`
          : `/app/${activeWorkspaceId}/projects/${activeEnvironmentId}/tasks/${created.taskId}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSubmitting(false);
    }
  }

  return (
    <div className="chat-layout task-composer-page" style={{ alignItems: "center", justifyContent: "center", display: "flex", flexDirection: "column" }}>
      <div className="task-composer-mode-toggles">
        <button
          type="button"
          className={`task-composer-mode-toggle${effectiveQuickMode ? " active quick" : ""}`}
          aria-pressed={effectiveQuickMode}
          aria-label={quickMode ? "Turn off Quick mode" : "Turn on Quick mode"}
          title={isInteractiveCanvasEnabled ? "Quick mode is disabled for canvas tasks" : effectiveQuickMode ? "Quick mode is on" : "Quick mode"}
          disabled={isSubmitting || workflow.type !== "standard" || isInteractiveCanvasEnabled}
          onClick={() => {
            updateDraft((current) => ({
              ...current,
              quickMode: current.workflow.type === "standard" ? !current.quickMode : false
            }));
          }}
        >
          <Zap size={18} />
        </button>
        <button
          type="button"
          className={`task-composer-mode-toggle${effectiveIncognitoMode ? " active incognito" : ""}`}
          aria-pressed={effectiveIncognitoMode}
          aria-label={incognitoMode ? "Turn off incognito chat" : "Turn on incognito chat"}
          title={isInteractiveCanvasEnabled ? "Incognito chat is disabled for canvas tasks" : effectiveIncognitoMode ? "Incognito chat is on" : "Incognito chat"}
          disabled={isSubmitting || workflow.type !== "standard" || isInteractiveCanvasEnabled}
          onClick={() => setIncognitoMode((current) => !current)}
        >
          <EyeOff size={18} />
        </button>
      </div>
      <div className="task-composer-container">
        <h1 className="task-composer-greeting">What can I help you with?</h1>

        <div data-onboarding-id="task-composer-input">
          <ChatInput
            value={prompt}
            onChange={(value) => {
              updateDraft((current) => ({
                ...current,
                prompt: value
              }));
            }}
            onSubmit={submitTask}
            isSubmitting={isSubmitting}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            onToggleAttachmentForceInclude={toggleAttachmentForceInclude}
            onAttachFiles={uploadFiles}
            onOpenEnvironmentFiles={() => setIsEnvironmentFilePickerOpen(true)}
            onOpenCanvases={() => setIsCanvasPickerOpen(true)}
            isUploading={isUploading}
            pendingUploads={pendingUploads}
            toolOptions={toolOptions}
            showMemorySearch={workspaceMemoryEnabled}
            showComputerUse={capabilities.isDesktop}
            onToolOptionsChange={(nextToolOptions) => {
              updateDraft((current) => ({
                ...current,
                toolOptions: normalizeToolOptions(nextToolOptions, draftDefaults)
              }));
            }}
            taskParameters={taskParameters}
            workflowConfig={workflow}
            onTaskParametersChange={(nextTaskParameters) => {
              updateDraft((current) => ({
                ...current,
                taskParameters: nextTaskParameters
              }));
            }}
            onWorkflowConfigChange={(nextWorkflowConfig) => {
              updateDraft((current) => ({
                ...current,
                workflow: nextWorkflowConfig,
                quickMode: nextWorkflowConfig.type === "standard" ? current.quickMode : false,
                taskParameters: nextWorkflowConfig.type === "standard"
                  ? current.taskParameters
                  : {
                    ...current.taskParameters,
                    schedule: buildDefaultTaskParameters().schedule
                  }
              }));
            }}
            taskParametersMode="create"
            availableSkills={availableSkills}
            availableSources={availableSources}
            attachableSources={attachableSources}
            availableAgents={availableAgents}
            selectedAgentId={selectedAgentId}
            defaultAgentId={defaultAgentId}
            modelSliderAgentIds={modelSliderAgentIds}
            onAgentChange={(nextAgentId) => {
              updateDraft((current) => {
                const workflow = resolveWorkflowForAgentChange({
                  workflow: current.workflow,
                  previousAgent: availableAgents.find((agent) => agent.id === selectedAgentId),
                  nextAgent: availableAgents.find((agent) => agent.id === nextAgentId),
                  nextAgentId
                });
                return {
                  ...current,
                  agentId: nextAgentId,
                  workflow,
                  quickMode: workflow.type === "standard" ? current.quickMode : false,
                  taskParameters: workflow.type === "standard"
                    ? current.taskParameters
                    : { ...current.taskParameters, schedule: buildDefaultTaskParameters().schedule }
                };
              });
            }}
            onSourceSetupRequested={() => {
              navigate(`/app/${activeWorkspaceId}/connectors?tab=sources`);
            }}
            onOpenSourceFiles={(source) => setSelectedSource(source)}
            showAgentSwitcher={canSelectTaskModel(user)}
            submitWithShiftEnter={taskUiPreferences.sendWithShiftEnter}
            subscriptionUsageWarning={subscriptionUsageWarning}
          />
        </div>

        <SuggestedActionPills
          actions={suggestedActions}
          onSelect={(action) => {
            updateDraft((current) => ({
              ...current,
              prompt: current.prompt.trim() ? `${current.prompt}\n${action.prompt}` : action.prompt
            }));
          }}
        />

        {(error || uploadError) && (
          <p className="error-text" style={{ marginTop: "1rem", textAlign: "center" }}>
            {error || uploadError}
          </p>
        )}
      </div>
      <EnvironmentFilePickerModal
        api={api}
        environmentId={activeEnvironmentId}
        isOpen={isEnvironmentFilePickerOpen}
        onClose={() => setIsEnvironmentFilePickerOpen(false)}
        onSelect={appendAttachments}
      />
      <CanvasPickerModal
        api={api}
        projectId={activeEnvironmentId}
        isOpen={isCanvasPickerOpen}
        onClose={() => setIsCanvasPickerOpen(false)}
        onAttach={(attachment) => appendAttachments([attachment])}
        onOpenInCanvasMode={(canvas) => {
          setSelectedInteractiveCanvas(canvas);
          appendAttachments([buildCanvasAttachment(canvas)]);
          updateDraft((current) => ({
            ...current,
            quickMode: false,
            toolOptions: {
              ...current.toolOptions,
              interactiveCanvas: true
            }
          }));
        }}
      />
      <SourceFilePickerModal
        api={api}
        workspaceId={activeWorkspaceId}
        environmentId={activeEnvironmentId}
        taskId={pendingTaskId}
        source={selectedSource}
        isOpen={selectedSource !== null}
        onClose={() => setSelectedSource(null)}
        onSelect={appendAttachments}
        destinationPath={taskInputUploadPath}
        createDirectories
        toAttachmentPath={(uploaded) => buildTaskInputAttachmentPath(taskInputUploadPath, uploaded.relativePath, uploaded.name)}
      />
    </div>
  );
}

import { getNewMessageOrganizationEnabled } from "@meowbert/shared/workspace-agent-settings";
import { useConversationNavigation } from "./navigation/useConversationNavigation";
import { useCallback, useEffect, useMemo } from "react";
import type { TaskMessage } from "../../../lib/types";
import { buildTaskInlineFileUrl } from "../../../lib/taskInlineFiles";
import { getMessageText } from "../../../lib/utils";
import { useTaskCanvas } from "./useTaskCanvas";
import { useTaskSwarmLanes } from "./useTaskSwarmLanes";
import { useTaskDetailActions } from "./useTaskDetailActions";
import { useTaskDetailComposer } from "./useTaskDetailComposer";
import { useTaskDetailConversationControllers } from "./useTaskDetailConversationControllers";
import type { TaskDetailPageContext } from "./useTaskDetailPageContext";
import { useTaskDetailViewState } from "./useTaskDetailViewState";
import { usePendingFollowUp, type PendingFollowUpControls } from "./usePendingFollowUp";
import { useProjectPersistentShellSessions } from "../../environment/overview/useProjectPersistentShellSessions";

function useLoadedTaskActions(
  context: TaskDetailPageContext,
  view: ReturnType<typeof useTaskDetailViewState>,
  composer: ReturnType<typeof useTaskDetailComposer>,
  controllers: ReturnType<typeof useTaskDetailConversationControllers>,
  pendingFollowUp: PendingFollowUpControls
) {
  return useTaskDetailActions({
    api: context.workspace.api,
    token: context.workspace.token,
    taskId: context.taskId,
    taskWorkspaceId: context.taskWorkspaceId,
    taskProjectId: context.taskProjectId,
    taskRootPath: context.taskRootPath,
    taskDetail: context.data.taskDetail,
    setTaskDetail: context.data.setTaskDetail,
    activeLeafMessageId: context.data.activeLeafMessageId,
    setActiveLeafMessageId: context.data.setActiveLeafMessageId,
    loadTask: context.data.loadTask,
    invalidateCurrentTaskCache: controllers.invalidateCurrentTaskCache,
    refreshTasks: context.workspace.refreshTasks,
    refreshWorkspaces: context.workspace.refreshWorkspaces,
    setFlash: context.workspace.setFlash,
    setError: context.setError,
    navigate: context.navigate,
    platform: context.runtime.platform,
    capabilities: context.runtime.capabilities,
    activeServerProfile: context.runtime.activeServerProfile,
    activeProject: context.activeProject,
    followUp: composer.followUp,
    setFollowUp: composer.setFollowUp,
    attachments: composer.attachments,
    clearAttachments: composer.clearAttachments,
    editingMessageId: composer.editingMessageId,
    setEditingMessageId: composer.setEditingMessageId,
    quotedFollowUpSelections: controllers.threads.quotedFollowUpSelections,
    setQuotedFollowUpSelections: controllers.threads.setQuotedFollowUpSelections,
    setSelectedTextDraft: controllers.threads.setSelectedTextDraft,
    selectedFollowUpCanvas: view.selectedFollowUpCanvas,
    setSelectedFollowUpCanvas: view.setSelectedFollowUpCanvas,
    toolOptions: composer.toolOptions,
    taskParameters: composer.taskParameters,
    workspaceMemoryEnabled: context.workspaceMemoryEnabled,
    selectedAgentId: composer.selectedAgentId,
    selectedMasterTaskAgentId: composer.selectedMasterTaskAgentId,
    cancelPendingConversationDraftPersist: composer.cancelPendingConversationDraftPersist,
    clearCurrentConversationDraft: composer.clearCurrentConversationDraft,
    persistedMessageDisplayPreferences: context.messageDisplayPreferences,
    pendingFollowUp
  });
}

function useTaskDetailArtifactEffects(
  context: TaskDetailPageContext,
  view: ReturnType<typeof useTaskDetailViewState>,
  controllers: ReturnType<typeof useTaskDetailConversationControllers>
) {
  useEffect(() => {
    const latestArtifactEvent = [...controllers.events.events].reverse().find((event) => event.type === "artifact");
    if (!latestArtifactEvent || view.latestArtifactEventIdRef.current === latestArtifactEvent.id) return;
    view.latestArtifactEventIdRef.current = latestArtifactEvent.id;
    void context.data.loadArtifacts();
  }, [context.data.loadArtifacts, controllers.events.events, view.latestArtifactEventIdRef]);
}

export function useTaskDetailLoadedController(context: TaskDetailPageContext) {
  const debugModeEnabled = context.data.taskDetail?.debug_mode === true;
  const view = useTaskDetailViewState(context.taskId, debugModeEnabled);
  const composer = useTaskDetailComposer({
    api: context.workspace.api,
    taskId: context.taskId,
    taskProjectId: context.taskProjectId,
    taskRootPath: context.taskRootPath,
    taskDetail: context.data.taskDetail,
    workspaceMemoryEnabled: context.workspaceMemoryEnabled,
    user: context.workspace.user,
    availableAgents: context.catalog.availableAgents,
    defaultAgentId: context.catalog.defaultAgentId
  });
  const controllers = useTaskDetailConversationControllers(context, view, composer);
  const pendingFollowUp = usePendingFollowUp(context.taskId, controllers.conversation.messages);
  const actions = useLoadedTaskActions(context, view, composer, controllers, pendingFollowUp);
  const organization = useConversationNavigation({
    api: context.workspace.api, taskId: context.taskId,
    enabled: Boolean(context.workspace.workspaceSettings) && getNewMessageOrganizationEnabled(context.workspace.workspaceSettings?.modelDefaults),
    leafId: context.data.activeLeafMessageId ?? context.data.taskDetail?.active_leaf_message_id ?? null,
    refreshKey: `${context.data.taskDetail?.task.updated_at}:${context.data.taskDetail?.task.status}`
  });
  const persistentShells = useProjectPersistentShellSessions({
    api: context.workspace.api,
    projectId: context.taskProjectId,
    taskId: context.taskId,
    includeOutput: view.tab === "shells"
  });
  const showMessageAuthors = useMemo(() => {
    const workspaceId = context.taskWorkspaceId ?? context.workspace.activeWorkspaceId;
    return (context.workspace.workspaces.find((item) => item.id === workspaceId)?.memberCount ?? 1) > 1;
  }, [context.taskWorkspaceId, context.workspace.activeWorkspaceId, context.workspace.workspaces]);
  const beginEditMessage = useCallback((message: TaskMessage) => {
    composer.flushPendingConversationDraft();
    controllers.switchTab("conversation");
    controllers.threads.setSelectedTextDraft(null);
    controllers.threads.setQuotedFollowUpSelections([]);
    composer.beginEditMessage(message);
    composer.setFollowUp(getMessageText(message));
    composer.clearAttachments();
    view.layout.setIsMobileInputExpanded(true);
  }, [composer, controllers, view.layout]);
  const cancelEditMessage = useCallback(() => {
    composer.setEditingMessageId(null);
    composer.setFollowUp("");
    controllers.threads.setQuotedFollowUpSelections([]);
    composer.clearAttachments();
  }, [composer, controllers.threads]);
  const buildInlineArtifactUrl = useCallback((relativePath: string) => (
    context.data.inlineFileTicket && context.taskId
      ? buildTaskInlineFileUrl(context.taskId, context.data.inlineFileTicket, relativePath)
      : null
  ), [context.data.inlineFileTicket, context.taskId]);

  const sendCanvasPrompt = useCallback((prompt: string) => void actions.handleSendPrompt(prompt), [actions.handleSendPrompt]);
  const canvas = useTaskCanvas({
    taskId: context.taskId,
    projectId: context.taskProjectId,
    token: context.workspace.token,
    inlineFileTicket: context.data.inlineFileTicket,
    projectCanvases: context.data.artifactCanvases,
    events: controllers.events.events,
    requestedCanvasId: new URLSearchParams(context.location.search).get("canvas"),
    sendPrompt: sendCanvasPrompt
  });

  const loadedTask = context.data.taskDetail?.task;
  const swarm = useTaskSwarmLanes({
    api: context.workspace.api,
    taskId: context.taskId,
    enabled: loadedTask?.task_type === "agent_swarm" && loadedTask.is_legacy_swarm !== true,
    events: controllers.events.events
  });

  useTaskDetailArtifactEffects(context, view, controllers);
  return {
    context,
    view,
    composer,
    controllers,
    actions,
    pendingFollowUp,
    persistentShells,
    organization,
    debugModeEnabled,
    showMessageAuthors,
    beginEditMessage,
    cancelEditMessage,
    buildInlineArtifactUrl,
    canvas,
    swarm
  };
}

export type TaskDetailLoadedController = ReturnType<typeof useTaskDetailLoadedController>;

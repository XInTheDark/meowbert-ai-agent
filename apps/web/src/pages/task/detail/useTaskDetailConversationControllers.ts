import { useCallback, useMemo } from "react";
import type { LiveToolCall, TaskMessage } from "../../../lib/types";
import type { ToolInspectorSelection } from "../../../components/taskConversation/ToolActivityInspectorPanel";
import { resolveToolInspectorSelection } from "../../../components/taskConversation/shared";
import { useTaskDetailBranchSwitcher } from "./useTaskDetailBranchSwitcher";
import { useTaskDetailConversation } from "./useTaskDetailConversation";
import { useTaskDetailEvents } from "./useTaskDetailEvents";
import { useTaskDetailSearch } from "./useTaskDetailSearch";
import { useTaskDetailThreads } from "./useTaskDetailThreads";
import type { TaskDetailPageContext } from "./useTaskDetailPageContext";
import type { TaskDetailViewState } from "./useTaskDetailViewState";
import type { TaskDetailComposer } from "./useTaskDetailComposer";
import type { TaskDetailTab } from "./taskDetailConstants";

function useConversationNavigation(context: TaskDetailPageContext, view: TaskDetailViewState) {
  const conversation = useTaskDetailConversation({
    api: context.workspace.api,
    taskId: context.taskId,
    activeTab: view.tab,
    activeLeafMessageId: context.data.activeLeafMessageId ?? context.data.taskDetail?.active_leaf_message_id ?? null,
    refreshVersion: context.data.conversationRefreshVersion,
    isMobileViewport: view.layout.isMobileViewport,
    isMobileInputExpanded: view.layout.isMobileInputExpanded
  });
  const search = useTaskDetailSearch({
    tab: view.tab,
    setTab: view.setTab,
    setActionsMenuOpen: view.setActionsMenuOpen,
    setMessageOutlineOpen: view.layout.setIsMessageOutlineOpen,
    jumpToMessage: conversation.jumpToMessage,
    jumpToMessageIndex: conversation.jumpToMessageIndex,
    messages: conversation.messages
  });
  return { conversation, search };
}

function useTaskActivity(
  context: TaskDetailPageContext,
  view: TaskDetailViewState,
  conversation: ReturnType<typeof useTaskDetailConversation>
) {
  const events = useTaskDetailEvents({
    api: context.workspace.api,
    taskId: context.taskId,
    token: context.workspace.token,
    activeTab: view.tab,
    taskStatus: context.data.taskDetail?.task.status,
    loadTaskSnapshot: context.data.loadFreshTaskSnapshot,
    setTaskDetail: context.data.setTaskDetail,
    onError: context.setError
  });
  const inspectorSelection = useMemo(() => resolveToolInspectorSelection(
    view.activityInspectorSelection,
    conversation.messages,
    events.liveToolCalls
  ), [conversation.messages, events.liveToolCalls, view.activityInspectorSelection]);
  const invalidateCurrentTaskCache = useCallback(() => {
    if (!context.taskId) return;
    context.workspace.api.invalidateGet?.({ pathPrefix: `/api/tasks/${context.taskId}` });
    if (context.taskProjectId) {
      context.workspace.api.invalidateGet?.({ pathPrefix: `/api/projects/${context.taskProjectId}/tasks` });
    }
  }, [context.taskId, context.taskProjectId, context.workspace.api]);
  const branch = useTaskDetailBranchSwitcher({
    api: context.workspace.api,
    taskId: context.taskId,
    branchOptionsByMessageId: conversation.branchOptionsByMessageId,
    invalidateCurrentTaskCache,
    setActiveLeafMessageId: context.data.setActiveLeafMessageId,
    setError: context.setError
  });
  return { events, inspectorSelection, invalidateCurrentTaskCache, branch };
}

export function useTaskDetailConversationControllers(
  context: TaskDetailPageContext,
  view: TaskDetailViewState,
  composer: TaskDetailComposer
) {
  const navigation = useConversationNavigation(context, view);
  const activity = useTaskActivity(context, view, navigation.conversation);
  const switchTab = useCallback((nextTab: TaskDetailTab) => {
    if (nextTab === "conversation") navigation.conversation.activateConversationTab();
    if (nextTab === "events" || nextTab === "debug") activity.events.activateEventsTab();
    view.setTab(nextTab);
  }, [activity.events.activateEventsTab, navigation.conversation.activateConversationTab, view.setTab]);
  const threads = useTaskDetailThreads({
    api: context.workspace.api,
    taskId: context.taskId,
    taskRootPath: context.taskRootPath,
    taskDetail: context.data.taskDetail,
    switchToConversation: () => switchTab("conversation"),
    jumpToMessage: navigation.conversation.jumpToMessage,
    invalidateCurrentTaskCache: activity.invalidateCurrentTaskCache,
    loadTask: context.data.loadTask,
    toolOptions: composer.toolOptions,
    workspaceMemoryEnabled: context.workspaceMemoryEnabled,
    capabilities: context.runtime.capabilities,
    selectedAgentId: composer.selectedAgentId,
    setMobileInputExpanded: view.layout.setIsMobileInputExpanded
  });
  return { ...navigation, ...activity, threads, switchTab };
}

export type TaskDetailConversationControllers = ReturnType<typeof useTaskDetailConversationControllers>;

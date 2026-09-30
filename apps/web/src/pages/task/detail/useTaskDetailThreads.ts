import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { TaskDetail, TaskMessage, TaskThreadSummary, TaskToolOptions } from "../../../lib/types";
import type { PlatformCapabilities } from "../../../desktop/platform";
import type { MessageSelectedTextQuote, SelectedTextQuote } from "../../../components/taskConversation/selectedTextQuoteUtils";
import { createTaskThread, listTaskThreads } from "../../../task/taskThreads";
import {
  buildThreadSidebarComposePanel,
  type TaskThreadSidebarPanel
} from "./TaskThreadSidebar";

interface UseTaskDetailThreadsInput {
  api: ApiClient;
  taskId: string;
  taskRootPath: string | null;
  taskDetail: TaskDetail | null;
  switchToConversation: () => void;
  jumpToMessage: (messageId: string, selectedText?: SelectedTextQuote | null) => void;
  invalidateCurrentTaskCache: () => void;
  loadTask: () => Promise<void>;
  toolOptions: TaskToolOptions;
  workspaceMemoryEnabled: boolean;
  capabilities: PlatformCapabilities;
  selectedAgentId: string | null;
  setMobileInputExpanded: (expanded: boolean) => void;
}

function useTaskThreadState(input: UseTaskDetailThreadsInput) {
  const [threadSidebarStack, setThreadSidebarStack] = useState<TaskThreadSidebarPanel[]>([]);
  const [threadSummariesByParentMessageId, setThreadSummariesByParentMessageId] = useState<Record<string, TaskThreadSummary[]>>({});
  const [selectedTextDraft, setSelectedTextDraft] = useState<MessageSelectedTextQuote | null>(null);
  const [quotedFollowUpSelections, setQuotedFollowUpSelections] = useState<SelectedTextQuote[]>([]);
  const threadCountsByParentMessageId = useMemo<Record<string, number>>(() => Object.fromEntries(
    (input.taskDetail?.thread_counts ?? []).map((entry) => [entry.parent_message_id, entry.count])
  ), [input.taskDetail?.thread_counts]);
  const threadParentMessageIds = useMemo(() => Object.entries(threadCountsByParentMessageId)
    .filter(([, count]) => count > 0)
    .map(([messageId]) => messageId)
    .sort(), [threadCountsByParentMessageId]);

  useEffect(() => {
    setThreadSidebarStack([]);
  }, [input.taskId]);

  useEffect(() => {
    if (!input.taskId || threadParentMessageIds.length === 0) {
      setThreadSummariesByParentMessageId({});
      return;
    }
    let cancelled = false;
    void Promise.all(threadParentMessageIds.map(async (messageId) => [
      messageId,
      await listTaskThreads(input.api, input.taskId, messageId)
    ] as const)).then((entries) => {
      if (!cancelled) setThreadSummariesByParentMessageId(Object.fromEntries(entries));
    }).catch((error) => {
      console.error(error);
      if (!cancelled) setThreadSummariesByParentMessageId({});
    });
    return () => {
      cancelled = true;
    };
  }, [input.api, input.taskId, threadParentMessageIds]);

  return {
    threadSidebarStack,
    setThreadSidebarStack,
    threadSummariesByParentMessageId,
    selectedTextDraft,
    setSelectedTextDraft,
    quotedFollowUpSelections,
    setQuotedFollowUpSelections,
    threadCountsByParentMessageId
  };
}

function useTaskThreadNavigation(
  input: UseTaskDetailThreadsInput,
  state: ReturnType<typeof useTaskThreadState>
) {
  const openThreadList = useCallback((
    parentTaskId: string,
    parentMessageId: string,
    parentTaskRootPath: string | null,
    selectedTextFilter?: SelectedTextQuote | null
  ): void => {
    input.switchToConversation();
    state.setThreadSidebarStack((current) => [...current, {
      kind: "list",
      taskId: parentTaskId,
      parentMessageId,
      parentTaskRootPath,
      selectedTextFilter: selectedTextFilter?.text.trim() ? selectedTextFilter : null
    }]);
  }, [input.switchToConversation]);

  const openThreadComposer = useCallback((
    parentTaskId: string,
    parentMessageId: string,
    parentTaskRootPath: string | null,
    selectedText?: SelectedTextQuote | null
  ): void => {
    input.switchToConversation();
    state.setSelectedTextDraft(null);
    state.setThreadSidebarStack((current) => [
      ...current,
      buildThreadSidebarComposePanel(parentTaskId, parentMessageId, parentTaskRootPath, selectedText)
    ]);
  }, [input.switchToConversation]);

  function openThreadConversation(threadTaskId: string, options?: {
    replaceTop?: boolean;
    parentMessageId?: string | null;
    selectedText?: SelectedTextQuote | null;
  }): void {
    input.switchToConversation();
    if (options?.parentMessageId) {
      input.jumpToMessage(options.parentMessageId, options.selectedText);
    }
    state.setThreadSidebarStack((current) => {
      const panel: TaskThreadSidebarPanel = { kind: "conversation", taskId: threadTaskId };
      return options?.replaceTop && current.length > 0
        ? [...current.slice(0, -1), panel]
        : [...current, panel];
    });
  }

  return {
    openThreadList,
    openThreadComposer,
    openThreadConversation,
    closeTopThreadPanel: () => state.setThreadSidebarStack((current) => current.slice(0, -1)),
    closeThreadSidebar: () => state.setThreadSidebarStack([])
  };
}

function useTaskSelectionThreadActions(
  input: UseTaskDetailThreadsInput,
  state: ReturnType<typeof useTaskThreadState>,
  navigation: ReturnType<typeof useTaskThreadNavigation>
) {
  const handleThreadComposerRequested = useCallback((message: TaskMessage, selectedText?: MessageSelectedTextQuote | null): void => {
    navigation.openThreadComposer(input.taskId, message.id, input.taskRootPath, selectedText);
  }, [input.taskId, input.taskRootPath, navigation.openThreadComposer]);

  const handleQuoteSelection = useCallback((selection: MessageSelectedTextQuote): void => {
    state.setQuotedFollowUpSelections((current) => [
      ...current,
      {
        text: selection.text,
        location: selection.location,
        comment: selection.comment ?? null
      }
    ]);
    state.setSelectedTextDraft(null);
    input.setMobileInputExpanded(true);
  }, []);
  const handleAskSelectionInThread = useCallback((selection: MessageSelectedTextQuote): void => {
    navigation.openThreadComposer(input.taskId, selection.messageId, input.taskRootPath, selection);
  }, [input.taskId, input.taskRootPath, navigation.openThreadComposer]);
  const handleThreadListRequested = useCallback((message: TaskMessage): void => {
    navigation.openThreadList(input.taskId, message.id, input.taskRootPath);
  }, [input.taskId, input.taskRootPath, navigation.openThreadList]);
  const handleOpenSelectionThreads = useCallback((message: TaskMessage, selection: MessageSelectedTextQuote): void => {
    navigation.openThreadList(input.taskId, message.id, input.taskRootPath, selection);
  }, [input.taskId, input.taskRootPath, navigation.openThreadList]);

  const handleSubmitSelectionThread = useCallback(async (
    selection: MessageSelectedTextQuote,
    message: string
  ): Promise<void> => {
    if (!input.taskId || !message.trim()) return;
    const created = await createTaskThread({
      api: input.api,
      taskId: input.taskId,
      pendingThreadTaskId: crypto.randomUUID(),
      messageId: selection.messageId,
      message,
      attachments: [],
      selectedText: selection,
      toolOptions: input.toolOptions,
      workspaceMemoryEnabled: input.workspaceMemoryEnabled,
      allowComputerUse: input.capabilities.isDesktop,
      selectedAgentId: input.selectedAgentId
    });
    input.invalidateCurrentTaskCache();
    state.setSelectedTextDraft(null);
    await input.loadTask();
    navigation.openThreadConversation(created.taskId, {
      parentMessageId: selection.messageId,
      selectedText: selection
    });
  }, [
    input.api,
    input.capabilities.isDesktop,
    input.loadTask,
    input.selectedAgentId,
    input.taskId,
    input.toolOptions,
    input.workspaceMemoryEnabled,
    navigation.openThreadConversation
  ]);

  return {
    handleThreadComposerRequested,
    handleQuoteSelection,
    handleAskSelectionInThread,
    handleRemoveQuotedSelection: (index: number) => state.setQuotedFollowUpSelections((current) => current.filter((_, i) => i !== index)),
    handleThreadListRequested,
    handleOpenSelectionThreads,
    handleSubmitSelectionThread
  };
}

export function useTaskDetailThreads(input: UseTaskDetailThreadsInput) {
  const state = useTaskThreadState(input);
  const navigation = useTaskThreadNavigation(input, state);
  const selectionActions = useTaskSelectionThreadActions(input, state, navigation);
  return { ...state, ...navigation, ...selectionActions };
}

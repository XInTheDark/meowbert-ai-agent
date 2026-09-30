import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ExternalLink, MessageSquarePlus, X } from "lucide-react";
import type { ApiClient } from "../../../lib/api";
import { API_CACHE_TTLS } from "../../../lib/api-cache";
import { ChatInput } from "../../../components/taskConversation/ChatInput";
import { SelectedTextQuoteCard } from "../../../components/taskConversation/SelectedTextQuoteCard";
import type { SelectedTextQuote } from "../../../components/taskConversation/selectedTextQuoteUtils";
import { InlineProgressBar } from "../../../components/InlineProgressBar";
import { SourceFilePickerModal } from "../../../components/modals/SourceFilePickerModal";
import { TaskStatusBadge } from "../../../components/tasks/TaskStatusBadge";
import { useFileUpload } from "../../../hooks/useFileUpload";
import { buildTaskMessageTree, getSiblingsForMessage, resolveLeafFromMessage } from "../../../task/taskMessageTree";
import {
  buildTaskConversationDraftKey,
  clearStoredTaskConversationDraft,
  getTaskConversationDraft,
  readTaskConversationDrafts,
  taskConversationDraftMatches,
  updateTaskConversationDraft,
  writeTaskConversationDrafts
} from "../../../task/taskConversationDrafts";
import {
  buildTaskInputAttachmentPath,
  buildTaskInputsDestinationPath,
  buildThreadTaskRootPath
} from "../../../task/taskFileDestinations";
import { buildTaskRoutePath, resolveTaskRouteContext } from "../../../task/taskRouteContext";
import { getTaskMessageAgentId } from "../../../task/taskModelSelection";
import { createTaskThread, listTaskThreads } from "../../../task/taskThreads";
import { useTaskDetailEvents } from "./useTaskDetailEvents";
import { TaskDetailConversationPane } from "./TaskDetailConversationPane";
import type {
  TaskAssistantMessageDisplayPreferences,
  TaskDetail,
  TaskMessage,
  TaskThreadSummary,
  TaskToolOptions
} from "../../../lib/types";
import { formatDateTime, formatRelative, getEffectiveTaskStatus, getMessageText, joinTaskMessage } from "../../../lib/utils";
import { requestTaskInterrupt, sendTaskFollowUp, switchTaskBranch } from "./taskDetailMutations";
import { distanceFromBottom } from "./taskDetailUtils";
import type { WorkspaceSourceSummary } from "../../../sources/sourceTypes";
import { useSubscriptionUsageWarning } from "../../../subscription/usageLimits";

function createPendingThreadTaskId(): string {
  return crypto.randomUUID();
}

export type TaskThreadSidebarPanel =
  | {
    kind: "list";
    taskId: string;
    parentMessageId: string;
    parentTaskRootPath: string | null;
    selectedTextFilter?: SelectedTextQuote | null;
  }
  | {
    kind: "compose";
    taskId: string;
    parentMessageId: string;
    parentTaskRootPath: string | null;
    selectedText: SelectedTextQuote | null;
    pendingThreadTaskId: string;
  }
  | {
    kind: "conversation";
    taskId: string;
  };

function buildThreadCountsMap(taskDetail: TaskDetail | null): Record<string, number> {
  const entries = taskDetail?.thread_counts ?? [];
  return Object.fromEntries(entries.map((entry) => [entry.parent_message_id, entry.count]));
}

function isTaskActiveStatus(status: string | null | undefined): boolean {
  return status === "queued" || status === "starting" || status === "running";
}

async function loadThreadTaskDetail(api: ApiClient, taskId: string, forceFresh: boolean): Promise<TaskDetail> {
  const path = `/api/tasks/${taskId}`;
  const snapshot = api.cachedGet?.<TaskDetail>(path, {
    ttlMs: forceFresh ? 0 : API_CACHE_TTLS.short
  });
  return snapshot ? snapshot.promise : api.get<TaskDetail>(path);
}

function getThreadDisplayStatus(taskDetail: TaskDetail): string {
  return getEffectiveTaskStatus({
    taskStatus: taskDetail.task.status,
    cancellationRequested: taskDetail.task.cancellation_requested,
    workflow: taskDetail.workflow
  });
}

function combineSelectedTextQuotes(quotes: SelectedTextQuote[]): SelectedTextQuote | null {
  if (quotes.length === 0) {
    return null;
  }

  if (quotes.length === 1) {
    return quotes[0];
  }

  return {
    text: quotes.map((quote, index) => [
      `Snippet ${index + 1}${quote.location ? ` (${quote.location})` : ""}:`,
      quote.text
    ].join("\n")).join("\n\n"),
    location: null
  };
}

function taskThreadMatchesSelectedText(item: TaskThreadSummary, filter: SelectedTextQuote): boolean {
  const selectedText = item.selected_text?.trim();
  if (!selectedText || selectedText !== filter.text.trim()) {
    return false;
  }

  return !filter.location || item.selected_text_location === filter.location || item.selected_text_location === null;
}

function ThreadSidebarHeader(props: {
  title: string;
  subtitle?: string | null;
  status?: string | null;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  standaloneHref?: string | null;
}) {
  return (
    <div className="thread-sidebar-header">
      <div className="thread-sidebar-header-main">
        {props.canGoBack ? (
          <button type="button" className="thread-sidebar-header-btn" onClick={props.onBack} title="Back">
            <ChevronLeft size={16} />
          </button>
        ) : null}
        <div className="thread-sidebar-header-text">
          <div className="thread-sidebar-title-row">
            <strong>{props.title}</strong>
            {props.status ? (
              <TaskStatusBadge status={props.status} className="thread-sidebar-status" iconSize={12} />
            ) : null}
          </div>
          {props.subtitle ? <span>{props.subtitle}</span> : null}
        </div>
      </div>
      <div className="thread-sidebar-header-actions">
        {props.standaloneHref ? (
          <a
            className="thread-sidebar-header-btn"
            href={props.standaloneHref}
            target="_blank"
            rel="noreferrer"
            title="Open thread"
            aria-label="Open thread"
          >
            <ExternalLink size={15} />
          </a>
        ) : null}
        <button type="button" className="thread-sidebar-header-btn" onClick={props.onClose} title="Close threads">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function ThreadListPanel(props: {
  api: ApiClient;
  panel: Extract<TaskThreadSidebarPanel, { kind: "list" }>;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onOpenConversation: (taskId: string, options?: {
    parentMessageId?: string | null;
    selectedText?: SelectedTextQuote | null;
  }) => void;
  onOpenComposer: (
    taskId: string,
    parentMessageId: string,
    parentTaskRootPath: string | null,
    selectedText?: SelectedTextQuote | null
  ) => void;
}) {
  const [items, setItems] = useState<TaskThreadSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void listTaskThreads(props.api, props.panel.taskId, props.panel.parentMessageId)
      .then((nextItems) => {
        if (!cancelled) {
          setItems(nextItems);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.api, props.panel.parentMessageId, props.panel.taskId]);
  const visibleItems = useMemo(() => {
    const filter = props.panel.selectedTextFilter;
    if (!filter?.text.trim()) {
      return items;
    }

    return items.filter((item) => taskThreadMatchesSelectedText(item, filter));
  }, [items, props.panel.selectedTextFilter]);
  const isFiltered = Boolean(props.panel.selectedTextFilter?.text.trim());

  return (
    <>
      <ThreadSidebarHeader
        title={isFiltered ? "Selected text threads" : "Threads"}
        subtitle={isFiltered ? "Follow-ups for this snippet" : "Follow-ups for this message"}
        canGoBack={props.canGoBack}
        onBack={props.onBack}
        onClose={props.onClose}
      />
      <div className="thread-sidebar-body">
        <div className="thread-sidebar-toolbar">
          <button
            type="button"
            className="btn ghost"
            onClick={() => props.onOpenComposer(
              props.panel.taskId,
              props.panel.parentMessageId,
              props.panel.parentTaskRootPath,
              props.panel.selectedTextFilter ?? null
            )}
          >
            <MessageSquarePlus size={15} />
            New thread
          </button>
        </div>
        {isLoading ? <InlineProgressBar pin="top" /> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {!isLoading && !error && visibleItems.length === 0 ? (
          <p className="muted-text">{isFiltered ? "No threads for this selection yet." : "No threads yet."}</p>
        ) : null}
        <div className="thread-list">
          {visibleItems.map((item) => (
            <button
              key={item.task_id}
              type="button"
              className="thread-list-item"
              onClick={() => props.onOpenConversation(item.task_id, {
                parentMessageId: item.parent_message_id,
                ...(item.selected_text
                  ? {
                      selectedText: {
                        text: item.selected_text,
                        location: item.selected_text_location
                      }
                    }
                  : {})
              })}
            >
              <div className="thread-list-item-header">
                <strong>{item.title?.trim() || "Untitled thread"}</strong>
              </div>
              <div className="thread-list-item-meta">
                <span className="muted-text" title={formatDateTime(item.updated_at)}>
                  {formatRelative(item.updated_at)}
                </span>
                <TaskStatusBadge status={item.status} className="thread-list-item-status" iconSize={12} />
              </div>
              {item.selected_text ? <blockquote className="thread-list-item-quote">{item.selected_text}</blockquote> : null}
              {item.latest_assistant_preview ? (
                <p className="thread-list-item-preview">{item.latest_assistant_preview}</p>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function ThreadComposerPanel(props: {
  api: ApiClient;
  activeEnvironmentId: string | null;
  activeWorkspaceId: string | null;
  workspaceMemoryEnabled: boolean;
  allowComputerUse: boolean;
  availableSkills: Array<{ id: string; name: string; description: string }>;
  availableSources: WorkspaceSourceSummary[];
  attachableSources: WorkspaceSourceSummary[];
  availableAgents: Array<{ id: string; name: string; description: string }>;
  defaultAgentId: string | null;
  modelSliderAgentIds?: string[];
  selectedAgentId: string | null;
  showAgentSwitcher: boolean;
  submitWithShiftEnter: boolean;
  initialToolOptions: TaskToolOptions;
  panel: Extract<TaskThreadSidebarPanel, { kind: "compose" }>;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onOpenConversation: (taskId: string, options?: {
    replaceTop?: boolean;
    parentMessageId?: string | null;
    selectedText?: SelectedTextQuote | null;
  }) => void;
  onCreated: () => void;
  onSourceSetupRequested?: (source: WorkspaceSourceSummary) => void;
}) {
  const [followUp, setFollowUp] = useState("");
  const [draftsByConversation, setDraftsByConversation] = useState(() => readTaskConversationDrafts());
  const [restoredConversationDraftKey, setRestoredConversationDraftKey] = useState<string | null>(null);
  const [toolOptions, setToolOptions] = useState<TaskToolOptions>(props.initialToolOptions);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(props.selectedAgentId);
  const [selectedSource, setSelectedSource] = useState<WorkspaceSourceSummary | null>(null);
  const [selectedTexts, setSelectedTexts] = useState<SelectedTextQuote[]>(() => (
    props.panel.selectedText ? [props.panel.selectedText] : []
  ));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscriptionUsageWarning = useSubscriptionUsageWarning();
  const conversationDraftKey = useMemo(() => (
    buildTaskConversationDraftKey(props.panel.pendingThreadTaskId)
  ), [props.panel.pendingThreadTaskId]);
  const currentConversationDraft = useMemo(() => (
    getTaskConversationDraft(draftsByConversation, conversationDraftKey)
  ), [conversationDraftKey, draftsByConversation]);
  const destinationPath = useMemo(() => {
    const threadTaskRootPath = buildThreadTaskRootPath(props.panel.parentTaskRootPath, props.panel.pendingThreadTaskId);
    return buildTaskInputsDestinationPath(threadTaskRootPath);
  }, [props.panel.parentTaskRootPath, props.panel.pendingThreadTaskId]);
  const {
    attachments,
    uploadFiles,
    removeAttachment,
    toggleAttachmentForceInclude,
    appendAttachments,
    isUploading,
    pendingUploads,
    uploadError
  } = useFileUpload(props.api, props.activeEnvironmentId, {
    destinationPath,
    createDirectories: true,
    toAttachmentPath: (uploaded) => buildTaskInputAttachmentPath(destinationPath, uploaded.relativePath, uploaded.name),
    initialAttachments: currentConversationDraft.attachments
  });

  useEffect(() => {
    writeTaskConversationDrafts(draftsByConversation);
  }, [draftsByConversation]);

  useEffect(() => {
    setRestoredConversationDraftKey(null);

    const nextDrafts = readTaskConversationDrafts();
    const nextDraft = getTaskConversationDraft(nextDrafts, conversationDraftKey);
    setDraftsByConversation(nextDrafts);
    setFollowUp(nextDraft.message);
    setRestoredConversationDraftKey(conversationDraftKey);
  }, [conversationDraftKey]);

  useEffect(() => {
    if (restoredConversationDraftKey !== conversationDraftKey) {
      return;
    }

    setDraftsByConversation((current) => {
      const latest = readTaskConversationDrafts();
      const hasDraftContent = followUp.trim().length > 0 || attachments.length > 0;
      if (!hasDraftContent && !(conversationDraftKey in current) && !(conversationDraftKey in latest)) {
        return current;
      }

      const merged = { ...current, ...latest };
      if (taskConversationDraftMatches(getTaskConversationDraft(merged, conversationDraftKey), followUp, attachments)) {
        return current;
      }

      return updateTaskConversationDraft(merged, conversationDraftKey, (draft) => ({
        ...draft,
        message: followUp,
        attachments
      }));
    });
  }, [attachments, conversationDraftKey, followUp, restoredConversationDraftKey]);

  useEffect(() => {
    setToolOptions(props.initialToolOptions);
    setSelectedAgentId(props.selectedAgentId);
    setSelectedTexts(props.panel.selectedText ? [props.panel.selectedText] : []);
    setError(null);
  }, [props.panel.pendingThreadTaskId, props.panel.selectedText, props.selectedAgentId]);

  async function handleSubmit(): Promise<void> {
    const message = joinTaskMessage(followUp, attachments);
    if (!message.trim()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const selectedText = combineSelectedTextQuotes(selectedTexts);
      const created = await createTaskThread({
        api: props.api,
        taskId: props.panel.taskId,
        pendingThreadTaskId: props.panel.pendingThreadTaskId,
        messageId: props.panel.parentMessageId,
        message,
        attachments,
        selectedText,
        toolOptions,
        workspaceMemoryEnabled: props.workspaceMemoryEnabled,
        allowComputerUse: props.allowComputerUse,
        selectedAgentId
      });
      setFollowUp("");
      setDraftsByConversation(clearStoredTaskConversationDraft(conversationDraftKey));
      props.onCreated();
      props.onOpenConversation(created.taskId, {
        replaceTop: true,
        parentMessageId: props.panel.parentMessageId,
        selectedText
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <ThreadSidebarHeader
        title="New thread"
        subtitle="Ask a follow-up in a sidebar thread"
        canGoBack={props.canGoBack}
        onBack={props.onBack}
        onClose={props.onClose}
      />
      <div className="thread-sidebar-body thread-composer-body">
        {selectedTexts.length > 0 ? (
          <div className="selected-text-quote-list thread-composer-quote-list">
            {selectedTexts.map((quote, index) => (
              <SelectedTextQuoteCard
                key={`${quote.location ?? "quote"}:${index}:${quote.text.slice(0, 24)}`}
                quote={quote}
                onRemove={() => setSelectedTexts((current) => current.filter((_, quoteIndex) => quoteIndex !== index))}
              />
            ))}
          </div>
        ) : null}
        <ChatInput
          popoverPlacement="auto"
          value={followUp}
          onChange={setFollowUp}
          onSubmit={() => {
            void handleSubmit();
          }}
          isSubmitting={isSubmitting}
          placeholder="Ask a follow-up..."
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          onToggleAttachmentForceInclude={toggleAttachmentForceInclude}
          onAttachFiles={uploadFiles}
          isUploading={isUploading}
          pendingUploads={pendingUploads}
          toolOptions={toolOptions}
          showMemorySearch={props.workspaceMemoryEnabled}
          showComputerUse={props.allowComputerUse}
          allowScheduleTaskOption={false}
          allowSubtasksOption={false}
          onToolOptionsChange={setToolOptions}
          availableSkills={props.availableSkills}
          availableSources={props.availableSources}
          attachableSources={props.attachableSources}
          availableAgents={props.availableAgents}
          selectedAgentId={selectedAgentId}
          defaultAgentId={props.defaultAgentId}
          modelSliderAgentIds={props.modelSliderAgentIds}
          onAgentChange={setSelectedAgentId}
          onSourceSetupRequested={props.onSourceSetupRequested}
          onOpenSourceFiles={(source) => setSelectedSource(source)}
          showAgentSwitcher={props.showAgentSwitcher}
          autoFocus
          submitWithShiftEnter={props.submitWithShiftEnter}
          subscriptionUsageWarning={subscriptionUsageWarning}
        />
        {error || uploadError ? <p className="error-text">{error || uploadError}</p> : null}
        <SourceFilePickerModal
          api={props.api}
          workspaceId={props.activeWorkspaceId}
          environmentId={props.activeEnvironmentId}
          taskId={props.panel.pendingThreadTaskId}
          source={selectedSource}
          isOpen={selectedSource !== null}
          onClose={() => setSelectedSource(null)}
          onSelect={appendAttachments}
          destinationPath={destinationPath}
          createDirectories
          toAttachmentPath={(uploaded) => buildTaskInputAttachmentPath(destinationPath, uploaded.relativePath, uploaded.name)}
        />
      </div>
    </>
  );
}

function ThreadConversationPanel(props: {
  api: ApiClient;
  token: string | null;
  activeEnvironmentId: string | null;
  activeWorkspaceId: string | null;
  workspaceMemoryEnabled: boolean;
  allowComputerUse: boolean;
  availableSkills: Array<{ id: string; name: string; description: string }>;
  availableSources: WorkspaceSourceSummary[];
  attachableSources: WorkspaceSourceSummary[];
  availableAgents: Array<{ id: string; name: string; description: string }>;
  defaultAgentId: string | null;
  modelSliderAgentIds?: string[];
  selectedAgentId: string | null;
  showAgentSwitcher: boolean;
  enableThreadSelectionPopup: boolean;
  submitWithShiftEnter: boolean;
  initialToolOptions: TaskToolOptions;
  assistantMessageDisplayPreferences: TaskAssistantMessageDisplayPreferences;
  showMessageAuthors?: boolean;
  panel: Extract<TaskThreadSidebarPanel, { kind: "conversation" }>;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onOpenComposer: (
    taskId: string,
    parentMessageId: string,
    parentTaskRootPath: string | null,
    selectedText?: SelectedTextQuote | null
  ) => void;
  onOpenList: (taskId: string, parentMessageId: string, parentTaskRootPath: string | null) => void;
  onRootRefreshRequested: () => void;
  onSourceSetupRequested?: (source: WorkspaceSourceSummary) => void;
}) {
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [draftsByConversation, setDraftsByConversation] = useState(() => readTaskConversationDrafts());
  const [restoredConversationDraftKey, setRestoredConversationDraftKey] = useState<string | null>(null);
  const [toolOptions, setToolOptions] = useState<TaskToolOptions>(props.initialToolOptions);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(props.selectedAgentId);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<WorkspaceSourceSummary | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const effectiveSelectedAgentId = editingMessageId ? editingAgentId : selectedAgentId;
  const [isBusy, setIsBusy] = useState(false);
  const [activeLeafMessageId, setActiveLeafMessageId] = useState<string | null>(null);
  const [branchSwitchingTo, setBranchSwitchingTo] = useState<string | null>(null);
  const threadConversationFeedRef = useRef<HTMLDivElement>(null);
  const threadConversationNearBottomRef = useRef(true);
  const pendingThreadConversationBottomAlignRef = useRef(true);
  const conversationDraftKey = useMemo(() => (
    buildTaskConversationDraftKey(props.panel.taskId)
  ), [props.panel.taskId]);
  const currentConversationDraft = useMemo(() => (
    getTaskConversationDraft(draftsByConversation, conversationDraftKey)
  ), [conversationDraftKey, draftsByConversation]);
  const taskRootPath = taskDetail?.task.task_root_path ?? null;
  const taskRouteContext = useMemo(() => resolveTaskRouteContext({
    routeWorkspaceId: props.activeWorkspaceId,
    routeEnvironmentId: props.activeEnvironmentId,
    taskWorkspaceId: taskDetail?.task.workspace_id ?? null,
    taskEnvironmentId: taskDetail?.task.environment_id ?? null
  }), [
    props.activeEnvironmentId,
    props.activeWorkspaceId,
    taskDetail?.task.environment_id,
    taskDetail?.task.workspace_id
  ]);
  const taskWorkspaceId = taskRouteContext.workspaceId ?? props.activeWorkspaceId;
  const taskEnvironmentId = taskRouteContext.environmentId ?? props.activeEnvironmentId;
  const destinationPath = useMemo(() => buildTaskInputsDestinationPath(taskRootPath), [taskRootPath]);
  const {
    attachments,
    uploadFiles,
    removeAttachment,
    toggleAttachmentForceInclude,
    appendAttachments,
    isUploading,
    pendingUploads,
    uploadError,
    clearAttachments
  } = useFileUpload(props.api, taskEnvironmentId, {
    destinationPath,
    createDirectories: true,
    toAttachmentPath: (uploaded) => buildTaskInputAttachmentPath(destinationPath, uploaded.relativePath, uploaded.name),
    initialAttachments: currentConversationDraft.attachments
  });

  const messageTree = useMemo(() => {
    return buildTaskMessageTree(
      taskDetail?.messages ?? [],
      activeLeafMessageId ?? taskDetail?.active_leaf_message_id ?? null
    );
  }, [activeLeafMessageId, taskDetail?.active_leaf_message_id, taskDetail?.messages]);
  const threadCountsByParentMessageId = useMemo(() => buildThreadCountsMap(taskDetail), [taskDetail]);
  const hydratedMessageIds = useMemo(
    () => new Set(messageTree.activeMessages.map((message) => message.id)),
    [messageTree.activeMessages]
  );
  const standaloneHref = useMemo(() => {
    if (!taskWorkspaceId || !taskRouteContext.projectId) {
      return null;
    }

    return buildTaskRoutePath({
      workspaceId: taskWorkspaceId,
      projectId: taskRouteContext.projectId,
      taskId: props.panel.taskId
    });
  }, [props.panel.taskId, taskRouteContext.projectId, taskWorkspaceId]);

  useEffect(() => {
    setToolOptions(props.initialToolOptions);
    setSelectedAgentId(taskDetail?.task.thread_agent_id ?? props.selectedAgentId);
  }, [props.selectedAgentId, props.panel.taskId, taskDetail?.task.thread_agent_id]);

  useEffect(() => {
    writeTaskConversationDrafts(draftsByConversation);
  }, [draftsByConversation]);

  useEffect(() => {
    setRestoredConversationDraftKey(null);

    const nextDrafts = readTaskConversationDrafts();
    const nextDraft = getTaskConversationDraft(nextDrafts, conversationDraftKey);
    setDraftsByConversation(nextDrafts);
    setFollowUp(nextDraft.message);
    setRestoredConversationDraftKey(conversationDraftKey);
  }, [conversationDraftKey]);

  useEffect(() => {
    if (restoredConversationDraftKey !== conversationDraftKey || editingMessageId) {
      return;
    }

    setDraftsByConversation((current) => {
      const latest = readTaskConversationDrafts();
      const hasDraftContent = followUp.trim().length > 0 || attachments.length > 0;
      if (!hasDraftContent && !(conversationDraftKey in current) && !(conversationDraftKey in latest)) {
        return current;
      }

      const merged = { ...current, ...latest };
      if (taskConversationDraftMatches(getTaskConversationDraft(merged, conversationDraftKey), followUp, attachments)) {
        return current;
      }

      return updateTaskConversationDraft(merged, conversationDraftKey, (draft) => ({
        ...draft,
        message: followUp,
        attachments
      }));
    });
  }, [attachments, conversationDraftKey, editingMessageId, followUp, restoredConversationDraftKey]);

  useEffect(() => {
    pendingThreadConversationBottomAlignRef.current = true;
    threadConversationNearBottomRef.current = true;
  }, [props.panel.taskId]);

  const loadTask = useCallback(async (options?: { silent?: boolean; forceFresh?: boolean }): Promise<void> => {
    if (!options?.silent) {
      setIsLoading(true);
    }

    try {
      const nextTaskDetail = await loadThreadTaskDetail(props.api, props.panel.taskId, Boolean(options?.forceFresh));
      setTaskDetail(nextTaskDetail);
      setActiveLeafMessageId(nextTaskDetail.active_leaf_message_id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTaskDetail(null);
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }, [props.api, props.panel.taskId]);

  const loadTaskSnapshot = useCallback(async (): Promise<void> => {
    await loadTask({ silent: true, forceFresh: true });
  }, [loadTask]);

  const {
    liveToolCalls,
    interruptingLiveToolCallIds,
    isThinking,
    handleInterruptLiveToolCall
  } = useTaskDetailEvents({
    api: props.api,
    taskId: props.panel.taskId,
    token: props.token,
    activeTab: "conversation",
    taskStatus: taskDetail?.task.status,
    loadTaskSnapshot,
    setTaskDetail,
    onError: setError
  });

  const displayStatus = taskDetail ? getThreadDisplayStatus(taskDetail) : null;
  const isThreadActive = isTaskActiveStatus(taskDetail?.task.status);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  useLayoutEffect(() => {
    const feed = threadConversationFeedRef.current;
    if (!feed) {
      return;
    }

    if (!pendingThreadConversationBottomAlignRef.current && !threadConversationNearBottomRef.current) {
      return;
    }

    feed.scrollTop = feed.scrollHeight;
    pendingThreadConversationBottomAlignRef.current = false;
    threadConversationNearBottomRef.current = true;
  }, [messageTree.activeMessages.length, taskDetail?.active_leaf_message_id, taskDetail?.task.updated_at]);

  function beginEditMessage(message: TaskMessage): void {
    setEditingAgentId(getTaskMessageAgentId(message));
    setEditingMessageId(message.id);
    setFollowUp(getMessageText(message));
    clearAttachments();
  }

  function cancelEditMessage(): void {
    setEditingMessageId(null);
    setFollowUp("");
    clearAttachments();
  }

  function handleAgentChange(agentId: string | null): void {
    if (editingMessageId) {
      setEditingAgentId(agentId);
    } else {
      setSelectedAgentId(agentId);
    }
  }

  async function switchBranch(message: TaskMessage, direction: -1 | 1): Promise<void> {
    const siblings = getSiblingsForMessage(messageTree, message);
    if (siblings.length < 2) {
      return;
    }

    const currentIndex = siblings.findIndex((candidate) => candidate.id === message.id);
    if (currentIndex < 0) {
      return;
    }

    const targetIndex = (currentIndex + direction + siblings.length) % siblings.length;
    const targetMessage = siblings[targetIndex];
    const targetLeafMessageId = resolveLeafFromMessage(messageTree, targetMessage.id);
    if (!targetLeafMessageId) {
      return;
    }

    setBranchSwitchingTo(targetLeafMessageId);
    try {
      await switchTaskBranch(props.api, props.panel.taskId, targetLeafMessageId);
      setActiveLeafMessageId(targetLeafMessageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBranchSwitchingTo(null);
    }
  }

  function renderBranchSwitcher(message: TaskMessage): JSX.Element | null {
    const siblings = getSiblingsForMessage(messageTree, message);
    if (siblings.length < 2) {
      return null;
    }

    const currentIndex = siblings.findIndex((candidate) => candidate.id === message.id);
    if (currentIndex < 0) {
      return null;
    }

    return (
      <div className="branch-switcher">
        <button
          type="button"
          className="branch-nav-btn"
          onClick={() => void switchBranch(message, -1)}
          disabled={branchSwitchingTo !== null}
          title="Previous branch"
        >
          &lt;
        </button>
        <span className="branch-index">
          Branch {currentIndex + 1}/{siblings.length}
        </span>
        <button
          type="button"
          className="branch-nav-btn"
          onClick={() => void switchBranch(message, 1)}
          disabled={branchSwitchingTo !== null}
          title="Next branch"
        >
          &gt;
        </button>
      </div>
    );
  }

  async function handleSubmit(): Promise<void> {
    const message = joinTaskMessage(followUp, attachments);
    if (!message.trim()) {
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      if (isThreadActive) {
        await requestInterruptAndMarkThread();
      }

      const response = await sendTaskFollowUp({
        api: props.api,
        taskId: props.panel.taskId,
        followUp,
        attachments,
        editingMessageId,
        toolOptions,
        workspaceMemoryEnabled: props.workspaceMemoryEnabled,
        allowComputerUse: props.allowComputerUse,
        selectedAgentId: effectiveSelectedAgentId,
        allowScheduleTask: false,
        allowSubtasks: false
      });
      setFollowUp("");
      clearAttachments();
      setDraftsByConversation(clearStoredTaskConversationDraft(conversationDraftKey));
      setEditingMessageId(null);
      if (response.activeLeafMessageId) {
        setActiveLeafMessageId(response.activeLeafMessageId);
      }
      await loadTask({ forceFresh: true });
      props.onRootRefreshRequested();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function requestInterruptAndMarkThread(): Promise<void> {
    await requestTaskInterrupt(props.api, props.panel.taskId);
    setTaskDetail((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        task: {
          ...current.task,
          cancellation_requested: true
        }
      };
    });
  }

  async function handleStop(): Promise<void> {
    setError(null);
    try {
      await requestInterruptAndMarkThread();
      await loadTask({ silent: true, forceFresh: true });
      props.onRootRefreshRequested();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <ThreadSidebarHeader
        title={taskDetail?.task.title?.trim() || "Thread"}
        subtitle={taskDetail?.task.thread_selected_text ? "Read-only thread" : "Conversation"}
        status={displayStatus}
        canGoBack={props.canGoBack}
        onBack={props.onBack}
        onClose={props.onClose}
        standaloneHref={standaloneHref}
      />
      <div className="thread-sidebar-body thread-sidebar-conversation">
        {isLoading ? <InlineProgressBar pin="top" /> : null}
        {error && !taskDetail ? <p className="error-text">{error}</p> : null}
        {taskDetail ? (
          <>
            {taskDetail.task.thread_selected_text && (taskDetail.messages?.length ?? 0) === 0 ? (
              <blockquote className="thread-conversation-quote">{taskDetail.task.thread_selected_text}</blockquote>
            ) : null}
            <TaskDetailConversationPane
              taskId={props.panel.taskId}
              messages={messageTree.activeMessages}
              assistantMessageDisplayPreferences={props.assistantMessageDisplayPreferences}
              showMessageAuthors={props.showMessageAuthors ?? false}
              isConversationBootstrapping={false}
              isConversationPageLoading={false}
              conversationPageLoadDirection={null}
              isTaskRunning={isThreadActive}
              isThinking={isThinking}
              chatFeedRef={threadConversationFeedRef}
              onScroll={() => {
                const feed = threadConversationFeedRef.current;
                if (!feed) {
                  return;
                }

                threadConversationNearBottomRef.current = distanceFromBottom(feed) <= 140;
              }}
              onConversationChanged={() => {
                void loadTask({ forceFresh: true });
                props.onRootRefreshRequested();
              }}
              onEditRequested={beginEditMessage}
              renderBranchSwitcher={renderBranchSwitcher}
              threadCountsByParentMessageId={threadCountsByParentMessageId}
              onThreadComposerRequested={(message, selectedText) => {
                props.onOpenComposer(props.panel.taskId, message.id, taskRootPath, selectedText);
              }}
              onThreadListRequested={(message) => {
                props.onOpenList(props.panel.taskId, message.id, taskRootPath);
              }}
              enableThreadSelectionPopup={props.enableThreadSelectionPopup}
              liveToolCalls={liveToolCalls}
              onInterruptLiveToolCall={handleInterruptLiveToolCall}
              interruptingLiveToolCallIds={interruptingLiveToolCallIds}
              hydratedMessageIds={hydratedMessageIds}
              onToolGroupExpandRequested={() => {}}
              isMobileViewport={false}
              isMobileInputExpanded
              onMobileInputExpandedChange={() => {}}
              editingMessageId={editingMessageId}
              onCancelEdit={cancelEditMessage}
              isBusy={isBusy}
              followUp={followUp}
              onFollowUpChange={setFollowUp}
              onSubmit={() => {
                void handleSubmit();
              }}
              attachments={attachments}
              onRemoveAttachment={removeAttachment}
              onToggleAttachmentForceInclude={toggleAttachmentForceInclude}
              onAttachFiles={uploadFiles}
              isUploading={isUploading}
              pendingUploads={pendingUploads}
              toolOptions={toolOptions}
              taskParameters={{
                schedule: { type: "standard", repeat: null, timezone: null, timeLimitSeconds: null },
                maxSteps: null,
                timeLimitSeconds: null,
                allowWaiting: true
              }}
              taskType={taskDetail.task.task_type}
              showMemorySearch={props.workspaceMemoryEnabled}
              showComputerUse={props.allowComputerUse}
              allowScheduleTaskOption={false}
              allowSubtasksOption={false}
              onToolOptionsChange={setToolOptions}
              onTaskParametersChange={() => {}}
              onStop={() => {
                void handleStop();
              }}
              availableSkills={props.availableSkills}
              availableSources={props.availableSources}
              attachableSources={props.attachableSources}
              availableAgents={props.availableAgents}
              selectedAgentId={effectiveSelectedAgentId}
              defaultAgentId={props.defaultAgentId}
              modelSliderAgentIds={props.modelSliderAgentIds}
              onAgentChange={handleAgentChange}
              onSourceSetupRequested={props.onSourceSetupRequested}
              onOpenSourceFiles={(source) => setSelectedSource(source)}
              showAgentSwitcher={props.showAgentSwitcher}
              errorText={error || uploadError}
              submitWithShiftEnter={props.submitWithShiftEnter}
            />
            <SourceFilePickerModal
              api={props.api}
              workspaceId={taskWorkspaceId}
              environmentId={taskEnvironmentId}
              taskId={props.panel.taskId}
              source={selectedSource}
              isOpen={selectedSource !== null}
              onClose={() => setSelectedSource(null)}
              onSelect={appendAttachments}
              destinationPath={destinationPath}
              createDirectories
              toAttachmentPath={(uploaded) => buildTaskInputAttachmentPath(destinationPath, uploaded.relativePath, uploaded.name)}
            />
          </>
        ) : null}
      </div>
    </>
  );
}

export function TaskThreadSidebar(props: {
  api: ApiClient;
  token: string | null;
  activeProjectId?: string | null;
  activeEnvironmentId: string | null;
  activeWorkspaceId: string | null;
  workspaceMemoryEnabled: boolean;
  allowComputerUse: boolean;
  availableSkills: Array<{ id: string; name: string; description: string }>;
  availableSources: WorkspaceSourceSummary[];
  attachableSources: WorkspaceSourceSummary[];
  availableAgents: Array<{ id: string; name: string; description: string }>;
  defaultAgentId: string | null;
  modelSliderAgentIds?: string[];
  selectedAgentId: string | null;
  showAgentSwitcher: boolean;
  enableThreadSelectionPopup: boolean;
  submitWithShiftEnter: boolean;
  initialToolOptions: TaskToolOptions;
  assistantMessageDisplayPreferences: TaskAssistantMessageDisplayPreferences;
  showMessageAuthors?: boolean;
  stack: TaskThreadSidebarPanel[];
  onBack: () => void;
  onClose: () => void;
  onOpenList: (taskId: string, parentMessageId: string, parentTaskRootPath: string | null) => void;
  onOpenComposer: (
    taskId: string,
    parentMessageId: string,
    parentTaskRootPath: string | null,
    selectedText?: SelectedTextQuote | null
  ) => void;
  onOpenConversation: (taskId: string, options?: {
    replaceTop?: boolean;
    parentMessageId?: string | null;
    selectedText?: SelectedTextQuote | null;
  }) => void;
  onRootRefreshRequested: () => void;
  onSourceSetupRequested?: (source: WorkspaceSourceSummary) => void;
}) {
  const activeEnvironmentId = props.activeProjectId ?? props.activeEnvironmentId;
  const panel = props.stack[props.stack.length - 1] ?? null;
  if (!panel) {
    return null;
  }

  return (
    <aside className="thread-sidebar">
      {panel.kind === "list" ? (
        <ThreadListPanel
          api={props.api}
          panel={panel}
          canGoBack={props.stack.length > 1}
          onBack={props.onBack}
          onClose={props.onClose}
          onOpenConversation={props.onOpenConversation}
          onOpenComposer={props.onOpenComposer}
        />
      ) : null}
      {panel.kind === "compose" ? (
        <ThreadComposerPanel
          api={props.api}
          activeEnvironmentId={activeEnvironmentId}
          activeWorkspaceId={props.activeWorkspaceId}
          workspaceMemoryEnabled={props.workspaceMemoryEnabled}
          allowComputerUse={props.allowComputerUse}
          availableSkills={props.availableSkills}
          availableSources={props.availableSources}
          attachableSources={props.attachableSources}
          availableAgents={props.availableAgents}
          defaultAgentId={props.defaultAgentId}
          modelSliderAgentIds={props.modelSliderAgentIds}
          selectedAgentId={props.selectedAgentId}
          showAgentSwitcher={props.showAgentSwitcher}
          submitWithShiftEnter={props.submitWithShiftEnter}
          initialToolOptions={props.initialToolOptions}
          panel={panel}
          canGoBack={props.stack.length > 1}
          onBack={props.onBack}
          onClose={props.onClose}
          onOpenConversation={props.onOpenConversation}
          onCreated={props.onRootRefreshRequested}
          onSourceSetupRequested={props.onSourceSetupRequested}
        />
      ) : null}
      {panel.kind === "conversation" ? (
        <ThreadConversationPanel
          api={props.api}
          token={props.token}
          activeEnvironmentId={activeEnvironmentId}
          activeWorkspaceId={props.activeWorkspaceId}
          workspaceMemoryEnabled={props.workspaceMemoryEnabled}
          allowComputerUse={props.allowComputerUse}
          availableSkills={props.availableSkills}
          availableSources={props.availableSources}
          attachableSources={props.attachableSources}
          availableAgents={props.availableAgents}
          defaultAgentId={props.defaultAgentId}
          modelSliderAgentIds={props.modelSliderAgentIds}
          selectedAgentId={props.selectedAgentId}
          showAgentSwitcher={props.showAgentSwitcher}
          enableThreadSelectionPopup={props.enableThreadSelectionPopup}
          submitWithShiftEnter={props.submitWithShiftEnter}
          initialToolOptions={props.initialToolOptions}
          assistantMessageDisplayPreferences={props.assistantMessageDisplayPreferences}
          showMessageAuthors={props.showMessageAuthors ?? false}
          panel={panel}
          canGoBack={props.stack.length > 1}
          onBack={props.onBack}
          onClose={props.onClose}
          onOpenComposer={props.onOpenComposer}
          onOpenList={props.onOpenList}
          onRootRefreshRequested={props.onRootRefreshRequested}
          onSourceSetupRequested={props.onSourceSetupRequested}
        />
      ) : null}
    </aside>
  );
}

export function buildThreadSidebarComposePanel(
  taskId: string,
  parentMessageId: string,
  parentTaskRootPath: string | null,
  selectedText?: SelectedTextQuote | null
): TaskThreadSidebarPanel {
  return {
    kind: "compose",
    taskId,
    parentMessageId,
    parentTaskRootPath,
    selectedText: selectedText?.text.trim() ? selectedText : null,
    pendingThreadTaskId: createPendingThreadTaskId()
  };
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  TaskConversationBranchOption,
  TaskConversationPageResponse,
  TaskMessage,
  TaskMessageContentBatchResponse
} from "../../../lib/types";
import { collectConversationHydrationIds } from "../../../task/taskDetailWindowing";
import {
  MESSAGE_MAX_WINDOW_ITEMS,
  MESSAGE_CACHE_MAX_ITEMS,
  MESSAGE_CHUNK_SIZE,
  NEAR_BOTTOM_THRESHOLD_PX,
  SCROLL_EDGE_THRESHOLD_PX
} from "./taskDetailConstants";
import { getNextTopbarCollapsedState } from "./taskDetailTopbarState";
import {
  findMessageElement,
  watchPendingConversationScroll,
  type ConversationTextAnchor
} from "./taskDetailConversationScroll";
import { distanceFromBottom } from "./taskDetailUtils";
import type {
  UseTaskDetailConversationOptions,
  UseTaskDetailConversationResult
} from "./taskDetailConversationTypes";

function normalizeBranchIndex(value: number | string, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBranchOptions(
  input: Record<string, TaskConversationBranchOption>
): Record<string, TaskConversationBranchOption> {
  const next: Record<string, TaskConversationBranchOption> = {};

  for (const [messageId, option] of Object.entries(input)) {
    const items = option.items.map((item) => ({
      ...item,
      index: normalizeBranchIndex(item.index)
    }));
    next[messageId] = {
      current_index: normalizeBranchIndex(option.current_index, -1),
      sibling_count: normalizeBranchIndex(option.sibling_count, items.length),
      items
    };
  }

  return next;
}

function trimMessageCache(
  order: string[],
  next: Record<string, TaskMessage>,
  pinnedMessageIds: string[]
): void {
  const pinned = new Set<string>(pinnedMessageIds);
  let guard = 0;

  while (order.length > MESSAGE_CACHE_MAX_ITEMS && guard < order.length + 2) {
    guard += 1;
    const candidate = order[0];
    if (!candidate) {
      break;
    }

    if (pinned.has(candidate)) {
      order.push(order.shift() ?? candidate);
      continue;
    }

    order.shift();
    delete next[candidate];
  }
}

function mergeOlderMessages(current: TaskMessage[], incoming: TaskMessage[]): TaskMessage[] {
  const seen = new Set(current.map((message) => message.id));
  const prepended = incoming.filter((message) => !seen.has(message.id));
  const merged = [...prepended, ...current];
  if (merged.length <= MESSAGE_MAX_WINDOW_ITEMS) {
    return merged;
  }
  return merged.slice(0, MESSAGE_MAX_WINDOW_ITEMS);
}

function mergeNewerMessages(current: TaskMessage[], incoming: TaskMessage[]): TaskMessage[] {
  const seen = new Set(current.map((message) => message.id));
  const appended = incoming.filter((message) => !seen.has(message.id));
  const merged = [...current, ...appended];
  if (merged.length <= MESSAGE_MAX_WINDOW_ITEMS) {
    return merged;
  }
  return merged.slice(Math.max(0, merged.length - MESSAGE_MAX_WINDOW_ITEMS));
}

function cacheConversationMessages(
  cache: Map<number, TaskMessage>,
  response: TaskConversationPageResponse,
  direction?: "older" | "newer"
): void {
  response.messages.forEach((message, offset) => {
    cache.set(response.message_page.start_index + offset, message);
  });

  while (cache.size > MESSAGE_CACHE_MAX_ITEMS) {
    const indexes = Array.from(cache.keys());
    const indexToDelete = direction === "older"
      ? Math.max(...indexes)
      : Math.min(...indexes);
    cache.delete(indexToDelete);
  }
}

function getCachedConversationPage(input: {
  cache: Map<number, TaskMessage>;
  totalItems: number;
  direction: "older" | "newer";
  beforeIndex?: number;
  afterIndex?: number;
}): TaskConversationPageResponse | null {
  const startIndex = input.direction === "older"
    ? Math.max(0, (input.beforeIndex ?? 0) - MESSAGE_CHUNK_SIZE)
    : Math.max(0, (input.afterIndex ?? -1) + 1);
  const endIndex = input.direction === "older"
    ? Math.max(0, input.beforeIndex ?? 0)
    : Math.min(input.totalItems, startIndex + MESSAGE_CHUNK_SIZE);
  const messages: TaskMessage[] = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    const message = input.cache.get(index);
    if (!message) {
      return null;
    }
    messages.push(message);
  }

  return {
    active_leaf_message_id: null,
    messages,
    message_page: {
      start_index: startIndex,
      end_index: endIndex,
      total_items: input.totalItems,
      has_older: startIndex > 0,
      has_newer: endIndex < input.totalItems
    },
    branch_options: {}
  };
}

function getVisibleMessagePage(input: {
  responsePage: TaskConversationPageResponse["message_page"];
  visibleMessageCount: number;
  direction?: "older" | "newer";
}): TaskConversationPageResponse["message_page"] {
  if (input.direction === "older") {
    const startIndex = input.responsePage.start_index;
    const endIndex = Math.min(input.responsePage.total_items, startIndex + input.visibleMessageCount);
    return {
      ...input.responsePage,
      start_index: startIndex,
      end_index: endIndex,
      has_older: startIndex > 0,
      has_newer: endIndex < input.responsePage.total_items
    };
  }

  if (input.direction === "newer") {
    const endIndex = input.responsePage.end_index;
    const startIndex = Math.max(0, endIndex - input.visibleMessageCount);
    return {
      ...input.responsePage,
      start_index: startIndex,
      end_index: endIndex,
      has_older: startIndex > 0,
      has_newer: endIndex < input.responsePage.total_items
    };
  }

  return input.responsePage;
}

function findFirstVisibleMessageAnchor(
  feed: HTMLElement,
  fallbackMessageId: string | null
): { anchorMessageId: string | null; anchorOffsetTop: number } {
  const feedRect = feed.getBoundingClientRect();
  const messageElements = feed.querySelectorAll<HTMLElement>("[data-message-id]");
  for (const el of messageElements) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > feedRect.top + 10) {
      return {
        anchorMessageId: el.dataset.messageId ?? fallbackMessageId,
        anchorOffsetTop: rect.top - feedRect.top
      };
    }
  }
  return {
    anchorMessageId: fallbackMessageId,
    anchorOffsetTop: 0
  };
}

function buildConversationSearchParams(input?: {
  beforeIndex?: number;
  afterIndex?: number;
  targetMessageId?: string;
  activeLeafMessageId?: string | null;
}): URLSearchParams {
  const searchParams = new URLSearchParams();
  searchParams.set("limit", String(MESSAGE_CHUNK_SIZE));
  if (typeof input?.beforeIndex === "number") {
    searchParams.set("beforeIndex", String(input.beforeIndex));
  }
  if (typeof input?.afterIndex === "number") {
    searchParams.set("afterIndex", String(input.afterIndex));
  }
  if (typeof input?.targetMessageId === "string" && input.targetMessageId.length > 0) {
    searchParams.set("targetMessageId", input.targetMessageId);
  }
  if (typeof input?.activeLeafMessageId === "string" && input.activeLeafMessageId.length > 0) {
    searchParams.set("activeLeafMessageId", input.activeLeafMessageId);
  }
  return searchParams;
}

export function useTaskDetailConversation(
  options: UseTaskDetailConversationOptions
): UseTaskDetailConversationResult {
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [branchOptionsByMessageId, setBranchOptionsByMessageId] = useState<Record<string, TaskConversationBranchOption>>({});
  const [messagePage, setMessagePage] = useState<{
    start_index: number;
    end_index: number;
    total_items: number;
    has_older: boolean;
    has_newer: boolean;
  }>({
    start_index: 0,
    end_index: 0,
    total_items: 0,
    has_older: false,
    has_newer: false
  });
  const [messageContentById, setMessageContentById] = useState<Record<string, TaskMessage>>({});
  const [isConversationBootstrapping, setIsConversationBootstrapping] = useState(true);
  const [isConversationPageLoading, setIsConversationPageLoading] = useState(false);
  const [conversationPageLoadDirection, setConversationPageLoadDirection] = useState<"older" | "newer" | null>(null);
  const [topbarCollapsed, setTopbarCollapsed] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [pendingConversationScrollVersion, setPendingConversationScrollVersion] = useState(0);
  const chatFeedRef = useRef<HTMLDivElement>(null);
  const conversationNearBottomRef = useRef(true);
  const pendingConversationBottomAlignRef = useRef(true);
  const pendingConversationScrollMessageIdRef = useRef<string | null>(null);
  const pendingConversationScrollTextAnchorRef = useRef<ConversationTextAnchor | null>(null);
  const pendingConversationScrollBehaviorRef = useRef<ScrollBehavior>("auto");
  const pendingConversationScrollAdjustmentRef = useRef<{
    anchorMessageId: string | null;
    anchorOffsetTop: number;
    fallbackScrollTop: number;
    fallbackScrollHeight: number;
  } | null>(null);
  const lastScrollTopRef = useRef(0);
  const suppressPaginationUntilRef = useRef(0);
  const requestKeyRef = useRef("");
  const pageLoadInFlightRef = useRef(false);
  const requestedToolMessageIdsRef = useRef<Set<string>>(new Set());
  const messageContentFetchInFlightRef = useRef<Set<string>>(new Set());
  const messageContentCacheOrderRef = useRef<string[]>([]);
  const messageContentByIdRef = useRef<Record<string, TaskMessage>>({});
  const messageLookupRef = useRef<Map<string, TaskMessage>>(new Map());
  const messageIdsRef = useRef<string[]>([]);
  const messagesRef = useRef<TaskMessage[]>([]);
  const conversationMessageCacheRef = useRef<Map<number, TaskMessage>>(new Map());
  const conversationMessageCacheTotalItemsRef = useRef(0);
  const loadedTaskIdRef = useRef<string | null>(null);
  const loadedActiveLeafMessageIdRef = useRef<string | null>(null);
  const resetLoadInFlightRef = useRef(false);
  const refreshVersionRef = useRef(options.refreshVersion ?? 0);
  const lastAutoFilledBeforeIndexRef = useRef<number | null>(null);

  const messageLookup = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const messageIds = useMemo(() => messages.map((message) => message.id), [messages]);
  const outlineMessages = messages;

  const hydratedMessageIds = useMemo(() => {
    const hydratedIds = new Set(Object.keys(messageContentById));
    for (const message of messages) {
      if (message.role !== "tool") {
        hydratedIds.add(message.id);
      }
    }
    return hydratedIds;
  }, [messageContentById, messages]);

  useEffect(() => {
    messageContentByIdRef.current = messageContentById;
  }, [messageContentById]);

  useEffect(() => {
    messageLookupRef.current = messageLookup;
    messageIdsRef.current = messageIds;
    messagesRef.current = messages;
  }, [messageIds, messageLookup]);

  const ensureMessageContentLoaded = useCallback(async (ids: string[]) => {
    if (!options.taskId || ids.length === 0) {
      return;
    }

    const missingIds = ids.filter((messageId) => {
      const inlineMessage = messageLookupRef.current.get(messageId);
      if (inlineMessage && inlineMessage.role !== "tool") {
        return false;
      }
      if (messageContentByIdRef.current[messageId]) {
        return false;
      }
      if (messageContentFetchInFlightRef.current.has(messageId)) {
        return false;
      }
      return true;
    });

    if (missingIds.length === 0) {
      return;
    }

    for (const messageId of missingIds) {
      messageContentFetchInFlightRef.current.add(messageId);
    }

    try {
      const response = await options.api.post<TaskMessageContentBatchResponse>(
        `/api/tasks/${options.taskId}/messages/content`,
        { ids: missingIds }
      );
      const hydratedById = new Map(response.items.map((message) => [message.id, message]));

      setMessageContentById((current) => {
        const next = { ...current };
        const order = messageContentCacheOrderRef.current;
        for (const message of response.items) {
          next[message.id] = message;
          const existingIndex = order.indexOf(message.id);
          if (existingIndex >= 0) {
            order.splice(existingIndex, 1);
          }
          order.push(message.id);
        }

        trimMessageCache(order, next, messageIdsRef.current);
        messageContentByIdRef.current = next;
        return next;
      });

      setMessages((current) => current.map((message) => {
        const hydrated = hydratedById.get(message.id);
        if (!hydrated || message.role !== "tool") {
          return message;
        }
        return hydrated;
      }));
    } catch (err) {
      console.error(err);
    } finally {
      for (const messageId of missingIds) {
        messageContentFetchInFlightRef.current.delete(messageId);
      }
    }
  }, [options.api, options.taskId]);

  const requestJumpToLoadedMessage = useCallback((
    messageId: string,
    textAnchor?: ConversationTextAnchor | null
  ) => {
    pendingConversationScrollAdjustmentRef.current = null;
    pendingConversationBottomAlignRef.current = false;
    pendingConversationScrollMessageIdRef.current = messageId;
    pendingConversationScrollTextAnchorRef.current = textAnchor ?? null;
    pendingConversationScrollBehaviorRef.current = "auto";
    conversationNearBottomRef.current = false;
    setPendingConversationScrollVersion((current) => current + 1);
    void ensureMessageContentLoaded([messageId]);
  }, [ensureMessageContentLoaded]);

  const loadConversationPage = useCallback(async (input?: {
    direction?: "older" | "newer";
    beforeIndex?: number;
    afterIndex?: number;
    targetMessageId?: string;
    activeLeafMessageId?: string | null;
    showBootstrap?: boolean;
    resetContentCache?: boolean;
  }) => {
    if (!options.taskId) {
      return;
    }

    const isWindowReload = !input?.direction;
    const showBootstrap = isWindowReload && input?.showBootstrap !== false;
    if (!isWindowReload && pageLoadInFlightRef.current) {
      return;
    }

    if (input?.direction === "newer") {
      pendingConversationScrollAdjustmentRef.current = null;
    }

    pageLoadInFlightRef.current = true;
    if (showBootstrap) {
      setIsConversationBootstrapping(true);
    } else if (!isWindowReload) {
      setIsConversationPageLoading(true);
      setConversationPageLoadDirection(input.direction ?? null);
    }

    const searchParams = buildConversationSearchParams(input);

    const requestKey = `${options.taskId}:${searchParams.toString()}`;
    requestKeyRef.current = requestKey;
    const cachedPage = input?.direction
      ? getCachedConversationPage({
        cache: conversationMessageCacheRef.current,
        totalItems: conversationMessageCacheTotalItemsRef.current,
        direction: input.direction,
        beforeIndex: input.beforeIndex,
        afterIndex: input.afterIndex
      })
      : null;

    try {
      const response = cachedPage ?? await options.api.get<TaskConversationPageResponse>(
        `/api/tasks/${options.taskId}/conversation?${searchParams.toString()}`
      );
      if (!cachedPage && requestKeyRef.current !== requestKey) {
        return;
      }
      if (isWindowReload) {
        conversationMessageCacheRef.current.clear();
      }
      cacheConversationMessages(conversationMessageCacheRef.current, response, input?.direction);
      conversationMessageCacheTotalItemsRef.current = response.message_page.total_items;
      loadedTaskIdRef.current = options.taskId;
      loadedActiveLeafMessageIdRef.current = response.active_leaf_message_id
        ?? loadedActiveLeafMessageIdRef.current;
      const normalizedBranchOptions = normalizeBranchOptions(response.branch_options);

      setBranchOptionsByMessageId((current) => {
        if (input?.direction === "older" || input?.direction === "newer") {
          return {
            ...current,
            ...normalizedBranchOptions
          };
        }
        return normalizedBranchOptions;
      });

      if (input?.direction === "older") {
        const currentMessages = messagesRef.current;
        const seen = new Set(currentMessages.map((message) => message.id));
        const prepended = response.messages.filter((message) => !seen.has(message.id));
        const nextMessages = mergeOlderMessages(currentMessages, response.messages);
        const feed = chatFeedRef.current;
        if (feed && prepended.length > 0) {
          const anchor = findFirstVisibleMessageAnchor(feed, currentMessages[0]?.id ?? null);
          pendingConversationScrollAdjustmentRef.current = {
            ...anchor,
            fallbackScrollTop: feed.scrollTop,
            fallbackScrollHeight: feed.scrollHeight
          };
        }
        pendingConversationBottomAlignRef.current = false;
        conversationNearBottomRef.current = false;
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        setMessagePage(getVisibleMessagePage({
          responsePage: response.message_page,
          visibleMessageCount: nextMessages.length,
          direction: "older"
        }));
      } else if (input?.direction === "newer") {
        const currentMessages = messagesRef.current;
        const nextMessages = mergeNewerMessages(currentMessages, response.messages);
        const feed = chatFeedRef.current;
        const firstRemaining = nextMessages[0];
        if (feed && firstRemaining) {
          const anchorEl = findMessageElement(feed, firstRemaining.id);
          const feedRect = feed.getBoundingClientRect();
          pendingConversationScrollAdjustmentRef.current = {
            anchorMessageId: firstRemaining.id,
            anchorOffsetTop: anchorEl ? anchorEl.getBoundingClientRect().top - feedRect.top : 0,
            fallbackScrollTop: feed.scrollTop,
            fallbackScrollHeight: feed.scrollHeight
          };
        }
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        setMessagePage(getVisibleMessagePage({
          responsePage: response.message_page,
          visibleMessageCount: nextMessages.length,
          direction: "newer"
        }));
      } else {
        messagesRef.current = response.messages;
        setMessages(response.messages);
        setMessagePage(response.message_page);
        const lastMessageId = response.messages[response.messages.length - 1]?.id ?? null;
        if (lastMessageId && (showBootstrap || conversationNearBottomRef.current)) {
          requestJumpToLoadedMessage(lastMessageId);
        }
        if (input?.resetContentCache !== false) {
          setMessageContentById({});
          messageContentByIdRef.current = {};
          messageContentCacheOrderRef.current = [];
        }
      }

      const hydrationIds = collectConversationHydrationIds(
        response.messages.map((message) => message.id),
        new Map(response.messages.map((message) => [message.id, message])),
        requestedToolMessageIdsRef.current
      );
      void ensureMessageContentLoaded(hydrationIds);
    } catch (err) {
      console.error(err);
    } finally {
      pageLoadInFlightRef.current = false;
      if (showBootstrap) {
        setIsConversationBootstrapping(false);
      }
      if (!isWindowReload) {
        setIsConversationPageLoading(false);
        setConversationPageLoadDirection(null);
      }
    }
  }, [ensureMessageContentLoaded, options.api, options.taskId, requestJumpToLoadedMessage]);

  useEffect(() => {
    loadedTaskIdRef.current = options.taskId || null;
    loadedActiveLeafMessageIdRef.current = null;
    refreshVersionRef.current = options.refreshVersion ?? 0;
    resetLoadInFlightRef.current = true;
    messagesRef.current = [];
    setMessages([]);
    setBranchOptionsByMessageId({});
    setMessagePage({
      start_index: 0,
      end_index: 0,
      total_items: 0,
      has_older: false,
      has_newer: false
    });
    setMessageContentById({});
    messageContentByIdRef.current = {};
    messageContentCacheOrderRef.current = [];
    conversationMessageCacheRef.current.clear();
    conversationMessageCacheTotalItemsRef.current = 0;
    messageContentFetchInFlightRef.current.clear();
    requestedToolMessageIdsRef.current = new Set();
    pendingConversationScrollAdjustmentRef.current = null;
    pendingConversationBottomAlignRef.current = true;
    pendingConversationScrollMessageIdRef.current = null;
    pendingConversationScrollTextAnchorRef.current = null;
    pendingConversationScrollBehaviorRef.current = "auto";
    conversationNearBottomRef.current = true;
    lastScrollTopRef.current = 0;
    lastAutoFilledBeforeIndexRef.current = null;
    setTopbarCollapsed(false);
    void loadConversationPage({
      activeLeafMessageId: options.activeLeafMessageId ?? null,
      showBootstrap: true,
      resetContentCache: true
    }).finally(() => {
      if (loadedTaskIdRef.current === options.taskId) {
        resetLoadInFlightRef.current = false;
      }
    });
  }, [loadConversationPage, options.taskId]);

  useEffect(() => {
    if (!options.taskId || loadedTaskIdRef.current !== options.taskId || resetLoadInFlightRef.current) {
      return;
    }

    const nextActiveLeafMessageId = options.activeLeafMessageId ?? null;
    if (loadedActiveLeafMessageIdRef.current === nextActiveLeafMessageId) {
      return;
    }

    void loadConversationPage({
      activeLeafMessageId: nextActiveLeafMessageId,
      showBootstrap: false,
      resetContentCache: false
    });
  }, [loadConversationPage, options.activeLeafMessageId, options.taskId]);

  useEffect(() => {
    const nextRefreshVersion = options.refreshVersion ?? 0;
    if (refreshVersionRef.current === nextRefreshVersion) {
      return;
    }

    refreshVersionRef.current = nextRefreshVersion;
    if (!options.taskId || loadedTaskIdRef.current !== options.taskId || resetLoadInFlightRef.current) {
      return;
    }

    void loadConversationPage({
      activeLeafMessageId: options.activeLeafMessageId ?? null,
      showBootstrap: false,
      resetContentCache: false
    });
  }, [loadConversationPage, options.activeLeafMessageId, options.refreshVersion, options.taskId]);

  useEffect(() => {
    if (options.isMobileViewport) {
      return;
    }

    setTopbarCollapsed(false);
  }, [options.isMobileViewport]);

  useEffect(() => {
    if (!options.isMobileViewport || !options.isMobileInputExpanded || options.activeTab !== "conversation") {
      return;
    }

    const feed = chatFeedRef.current;
    if (!feed) {
      return;
    }

    if (distanceFromBottom(feed) < 180) {
      feed.scrollTop = feed.scrollHeight;
    }
  }, [options.activeTab, options.isMobileInputExpanded, options.isMobileViewport]);

  useEffect(() => {
    return watchPendingConversationScroll({
      activeTab: options.activeTab,
      chatFeedRef,
      conversationNearBottomRef,
      pendingConversationScrollBehaviorRef,
      pendingConversationScrollMessageIdRef,
      pendingConversationScrollTextAnchorRef
    });
  }, [messages.length, options.activeTab, pendingConversationScrollVersion]);

  useLayoutEffect(() => {
    const pending = pendingConversationScrollAdjustmentRef.current;
    if (!pending) {
      return;
    }
    pendingConversationScrollAdjustmentRef.current = null;

    const feed = chatFeedRef.current;
    if (!feed) {
      return;
    }

    if (pending.anchorMessageId) {
      const anchorEl = findMessageElement(feed, pending.anchorMessageId);
      if (anchorEl) {
        const currentOffsetTop = anchorEl.getBoundingClientRect().top - feed.getBoundingClientRect().top;
        const delta = currentOffsetTop - pending.anchorOffsetTop;
        if (Math.abs(delta) > 0.5) {
          suppressPaginationUntilRef.current = Date.now() + 200;
          feed.scrollTop = Math.max(0, feed.scrollTop + delta);
          lastScrollTopRef.current = feed.scrollTop;
          return;
        }
      }
    }

    const heightDelta = feed.scrollHeight - pending.fallbackScrollHeight;
    if (heightDelta > 0) {
      suppressPaginationUntilRef.current = Date.now() + 200;
      feed.scrollTop = Math.max(0, pending.fallbackScrollTop + heightDelta);
      lastScrollTopRef.current = feed.scrollTop;
    }
  }, [messages]);

  useEffect(() => {
    if (options.activeTab !== "conversation") {
      return;
    }

    if (pendingConversationScrollMessageIdRef.current) {
      return;
    }

    if (!pendingConversationBottomAlignRef.current) {
      return;
    }

    const feed = chatFeedRef.current;
    if (!feed) {
      return;
    }

    feed.scrollTop = feed.scrollHeight;
    pendingConversationBottomAlignRef.current = false;
  }, [messages.length, options.activeTab]);

  useEffect(() => {
    if (
      options.activeTab !== "conversation"
      || isConversationBootstrapping
      || isConversationPageLoading
    ) {
      return;
    }

    const feed = chatFeedRef.current;
    if (!feed || feed.clientHeight === 0) {
      return;
    }

    const checkAndFillOlder = () => {
      if (
        messagePage.has_older
        && !messagePage.has_newer
        && messages.length < MESSAGE_MAX_WINDOW_ITEMS
        && feed.clientHeight > 0
        && feed.scrollHeight <= feed.clientHeight + 1
        && lastAutoFilledBeforeIndexRef.current !== messagePage.start_index
      ) {
        lastAutoFilledBeforeIndexRef.current = messagePage.start_index;
        void loadConversationPage({
          direction: "older",
          beforeIndex: messagePage.start_index
        });
      }
    };

    checkAndFillOlder();

    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(() => {
        checkAndFillOlder();
      });
      resizeObserver.observe(feed);
      return () => resizeObserver.disconnect();
    }
  }, [
    isConversationBootstrapping,
    isConversationPageLoading,
    loadConversationPage,
    messagePage.has_newer,
    messagePage.has_older,
    messagePage.start_index,
    messages.length,
    options.activeTab
  ]);

  const handleToolGroupExpandRequested = useCallback((toolMessageIds: string[]) => {
    const nextIds: string[] = [];
    for (const messageId of toolMessageIds) {
      if (requestedToolMessageIdsRef.current.has(messageId)) {
        continue;
      }
      requestedToolMessageIdsRef.current.add(messageId);
      nextIds.push(messageId);
    }

    if (nextIds.length === 0) {
      return;
    }

    void ensureMessageContentLoaded(nextIds);
  }, [ensureMessageContentLoaded]);

  const handleConversationScroll = useCallback(() => {
    const feed = chatFeedRef.current;
    if (!feed) {
      return;
    }

    const currentScrollTop = feed.scrollTop;
    const previousScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = currentScrollTop;

    const nearBottom = distanceFromBottom(feed) <= NEAR_BOTTOM_THRESHOLD_PX;
    const isAtConversationBottom = nearBottom && !messagePage.has_newer;
    conversationNearBottomRef.current = isAtConversationBottom;
    if (!isAtConversationBottom) {
      pendingConversationBottomAlignRef.current = false;
    }
    setIsNearBottom(isAtConversationBottom);

    if (options.isMobileViewport && options.activeTab === "conversation") {
      setTopbarCollapsed((current) => getNextTopbarCollapsedState({
        currentScrollTop,
        previousScrollTop,
        wasCollapsed: current
      }));
    }

    if (pendingConversationScrollMessageIdRef.current) {
      return;
    }

    if (isConversationBootstrapping || isConversationPageLoading) {
      return;
    }

    if (Date.now() < suppressPaginationUntilRef.current) {
      return;
    }

    const isScrollingDown = currentScrollTop > previousScrollTop;
    const isScrollingUp = currentScrollTop < previousScrollTop;
    const nearTop = feed.scrollTop <= SCROLL_EDGE_THRESHOLD_PX;

    if (isScrollingDown) {
      if (nearBottom && messagePage.has_newer) {
        void loadConversationPage({
          direction: "newer",
          afterIndex: Math.max(0, messagePage.end_index - 1)
        });
      }
      return;
    }

    if (isScrollingUp || (nearTop && !nearBottom)) {
      if (nearTop && messagePage.has_older) {
        void loadConversationPage({
          direction: "older",
          beforeIndex: messagePage.start_index
        });
      }
      return;
    }
  }, [
    isConversationBootstrapping,
    isConversationPageLoading,
    loadConversationPage,
    messagePage.end_index,
    messagePage.has_newer,
    messagePage.has_older,
    messagePage.start_index,
    options.activeTab,
    options.isMobileViewport
  ]);

  const handleConversationWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const feed = chatFeedRef.current;
    if (!feed) {
      return;
    }

    if (isConversationBootstrapping || isConversationPageLoading) {
      return;
    }

    if (Date.now() < suppressPaginationUntilRef.current) {
      return;
    }

    if (event.deltaY < 0) {
      if ((feed.scrollTop <= SCROLL_EDGE_THRESHOLD_PX || feed.scrollHeight <= feed.clientHeight + 1) && messagePage.has_older) {
        void loadConversationPage({
          direction: "older",
          beforeIndex: messagePage.start_index
        });
      }
      return;
    }

    if (event.deltaY > 0) {
      const nearBottom = distanceFromBottom(feed) <= NEAR_BOTTOM_THRESHOLD_PX;
      if ((nearBottom || feed.scrollHeight <= feed.clientHeight + 1) && messagePage.has_newer) {
        void loadConversationPage({
          direction: "newer",
          afterIndex: Math.max(0, messagePage.end_index - 1)
        });
      }
    }
  }, [
    isConversationBootstrapping,
    isConversationPageLoading,
    loadConversationPage,
    messagePage.end_index,
    messagePage.has_newer,
    messagePage.has_older,
    messagePage.start_index
  ]);

  const jumpToMessage = useCallback((messageId: string, textAnchor?: ConversationTextAnchor | null) => {
    if (messageLookupRef.current.has(messageId)) {
      requestJumpToLoadedMessage(messageId, textAnchor);
      return;
    }

    if (pageLoadInFlightRef.current) {
      return;
    }

    pendingConversationBottomAlignRef.current = false;
    void loadConversationPage({
      targetMessageId: messageId,
      showBootstrap: false,
      resetContentCache: false
    }).then(() => {
      if (messagesRef.current.some((message) => message.id === messageId)) {
        requestJumpToLoadedMessage(messageId, textAnchor);
      }
    });
  }, [loadConversationPage, requestJumpToLoadedMessage]);

  const jumpToMessageIndex = useCallback(async (messageId: string, messageIndex: number) => {
    const isLoaded = messageLookup.has(messageId);
    if (isLoaded) {
      jumpToMessage(messageId);
      return;
    }

    if (messageIndex < 0) {
      return;
    }

    const beforeIndex = messageIndex + 1;
    if (pageLoadInFlightRef.current) {
      return;
    }

    pendingConversationBottomAlignRef.current = false;
    await loadConversationPage({
      beforeIndex,
      showBootstrap: false,
      resetContentCache: false
    });

    requestJumpToLoadedMessage(messageId);
  }, [jumpToMessage, loadConversationPage, messageLookup, requestJumpToLoadedMessage]);

  const visibleMessages = useMemo(
    () => messages.map((message) => {
      if (message.role !== "tool") {
        return message;
      }
      return messageContentById[message.id] ?? message;
    }),
    [messageContentById, messages]
  );

  return {
    messages: visibleMessages,
    outlineMessages,
    branchOptionsByMessageId,
    hydratedMessageIds,
    isConversationBootstrapping,
    isConversationPageLoading,
    conversationPageLoadDirection,
    chatFeedRef,
    messagePage,
    topbarCollapsed,
    isNearBottom,
    expandTopbar: () => setTopbarCollapsed(false),
    activateConversationTab: () => {
      pendingConversationBottomAlignRef.current = true;
      conversationNearBottomRef.current = true;
      setIsNearBottom(true);
    },
    handleConversationScroll,
    handleConversationWheel,
    handleToolGroupExpandRequested,
    jumpToMessage,
    jumpToMessageIndex
  };
}

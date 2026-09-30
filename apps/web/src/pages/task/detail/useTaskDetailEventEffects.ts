import { useEffect, useLayoutEffect } from "react";
import { appendStreamTicket, fetchTaskEventStreamTicket } from "../../../lib/stream-tickets";
import { appendEventsWithCap } from "../../../task/taskDetailWindowing";
import { EVENT_MAX_WINDOW_ITEMS } from "./taskDetailConstants";
import type { TaskDetailEventsState, UseTaskDetailEventsOptions } from "./taskDetailEventTypes";

const REPLAY_EVENT_NAMES = [
  "status",
  "log",
  "command_start",
  "command_end",
  "model_routed",
  "thinking_start",
  "thinking_end",
  "context_usage",
  "compaction",
  "notification",
  "artifact",
  "error"
];

export function useTaskDetailEventEffects(input: {
  options: UseTaskDetailEventsOptions;
  state: TaskDetailEventsState;
  appendLiveEvent: (raw: unknown, fallbackType?: string) => void;
  catchUpMissedEvents: () => Promise<void>;
  loadInitialEvents: () => Promise<void>;
  streamUrl: URL;
}): void {
  useTaskDetailEventResetEffect(input.options, input.state, input.loadInitialEvents);
  useTaskDetailEventLayoutEffects(input.options, input.state);
  useTaskDetailEventStreamEffect(
    input.options,
    input.streamUrl,
    input.appendLiveEvent,
    input.catchUpMissedEvents
  );
  useTaskDetailEventPendingLiveEffects(input.options, input.state);
  useTaskDetailEventStatusEffects(input.options, input.state);
}

function useTaskDetailEventResetEffect(
  options: UseTaskDetailEventsOptions,
  state: TaskDetailEventsState,
  loadInitialEvents: () => Promise<void>
): void {
  useEffect(() => {
    state.setEvents([]);
    state.setEventsHasOlder(false);
    state.setEventsHasNewer(false);
    state.setPendingLiveEvents([]);
    state.setIsEventsBootstrapping(false);
    state.setIsEventsPageLoading(false);
    state.setLiveToolCalls([]);
    state.setInterruptingLiveToolCallIds([]);
    state.setIsThinking(false);
    state.eventsNearBottomRef.current = true;
    state.eventsPaginationInFlightRef.current = false;
    state.eventsCatchUpInFlightRef.current = false;
    state.lastSeenEventCursorRef.current = null;
    state.pendingEventsBottomAlignRef.current = false;
    state.pendingEventsPrependRef.current = null;

    if (!options.taskId) {
      return;
    }

    void loadInitialEvents();
  }, [
    loadInitialEvents,
    options.taskId,
    state.eventsCatchUpInFlightRef,
    state.eventsNearBottomRef,
    state.eventsPaginationInFlightRef,
    state.lastSeenEventCursorRef,
    state.pendingEventsBottomAlignRef,
    state.pendingEventsPrependRef,
    state.setEvents,
    state.setEventsHasNewer,
    state.setEventsHasOlder,
    state.setInterruptingLiveToolCallIds,
    state.setIsEventsBootstrapping,
    state.setIsEventsPageLoading,
    state.setIsThinking,
    state.setLiveToolCalls,
    state.setPendingLiveEvents
  ]);
}

function useTaskDetailEventLayoutEffects(
  options: UseTaskDetailEventsOptions,
  state: TaskDetailEventsState
): void {
  useLayoutEffect(() => {
    const pending = state.pendingEventsPrependRef.current;
    if (!pending) {
      return;
    }

    const feed = state.eventsFeedRef.current;
    if (!feed) {
      return;
    }

    const heightDelta = feed.scrollHeight - pending.scrollHeight;
    if (heightDelta !== 0) {
      feed.scrollTop = pending.scrollTop + heightDelta;
    }

    state.pendingEventsPrependRef.current = null;
  }, [options.activeTab, state.eventsFeedRef, state.eventsWindowKey, state.pendingEventsPrependRef]);

  useLayoutEffect(() => {
    if (options.activeTab !== "events" || state.events.length === 0) {
      return;
    }

    if (!state.pendingEventsBottomAlignRef.current && !state.eventsNearBottomRef.current) {
      return;
    }

    const feed = state.eventsFeedRef.current;
    if (!feed) {
      return;
    }

    feed.scrollTop = feed.scrollHeight;
    state.pendingEventsBottomAlignRef.current = false;
    state.eventsNearBottomRef.current = true;
  }, [
    options.activeTab,
    state.events.length,
    state.eventsFeedRef,
    state.eventsNearBottomRef,
    state.eventsWindowKey,
    state.pendingEventsBottomAlignRef
  ]);
}

function useTaskDetailEventStreamEffect(
  options: UseTaskDetailEventsOptions,
  streamUrl: URL,
  appendLiveEvent: (raw: unknown, fallbackType?: string) => void,
  catchUpMissedEvents: () => Promise<void>
): void {
  useEffect(() => {
    if (!options.taskId || !options.token) {
      return;
    }

    const authToken = options.token;
    let isDisposed = false;
    let source: EventSource | null = null;
    let reconnectDelayMs = 1_000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (isDisposed || reconnectTimer) {
        return;
      }

      const delay = reconnectDelayMs;
      reconnectDelayMs = Math.min(60_000, reconnectDelayMs * 2);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const attachReplayListeners = (targetSource: EventSource) => {
      targetSource.addEventListener("open", () => {
        if (isDisposed || source !== targetSource) {
          return;
        }
        reconnectDelayMs = 1_000;
        void catchUpMissedEvents();
      });

      targetSource.addEventListener("update", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data);
          appendLiveEvent(data);
        } catch {
          // Ignore malformed event payloads.
        }
      });

      for (const eventName of REPLAY_EVENT_NAMES) {
        targetSource.addEventListener(eventName, (event) => {
          try {
            const data = JSON.parse((event as MessageEvent).data);
            appendLiveEvent(data, eventName);
          } catch {
            // Ignore malformed replay payloads.
          }
        });
      }

      targetSource.addEventListener("error", () => {
        if (source !== targetSource) {
          return;
        }
        targetSource.close();
        source = null;
        scheduleReconnect();
      });
    };

    const connect = async () => {
      try {
        const ticket = await fetchTaskEventStreamTicket(options.taskId, authToken);
        if (isDisposed) {
          return;
        }

        const ticketedUrl = appendStreamTicket(streamUrl, ticket);
        const nextSource = new EventSource(ticketedUrl, { withCredentials: false });
        source = nextSource;
        attachReplayListeners(nextSource);
      } catch {
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      isDisposed = true;
      clearReconnectTimer();
      source?.close();
      source = null;
    };
  }, [appendLiveEvent, catchUpMissedEvents, options.taskId, options.token, streamUrl]);
}

function useTaskDetailEventPendingLiveEffects(
  options: UseTaskDetailEventsOptions,
  state: TaskDetailEventsState
): void {
  useEffect(() => {
    if (options.activeTab !== "events" || state.pendingLiveEvents.length === 0) {
      return;
    }

    if (state.events.length + state.pendingLiveEvents.length > EVENT_MAX_WINDOW_ITEMS) {
      state.setEventsHasOlder(true);
    }

    state.setEvents((current) =>
      appendEventsWithCap(current, state.pendingLiveEvents, EVENT_MAX_WINDOW_ITEMS)
    );
    state.setPendingLiveEvents([]);
    state.setEventsHasNewer(false);

    if (state.eventsNearBottomRef.current) {
      state.pendingEventsBottomAlignRef.current = true;
    }
  }, [
    options.activeTab,
    state.events.length,
    state.eventsNearBottomRef,
    state.pendingEventsBottomAlignRef,
    state.pendingLiveEvents,
    state.setEvents,
    state.setEventsHasNewer,
    state.setEventsHasOlder,
    state.setPendingLiveEvents
  ]);
}

function useTaskDetailEventStatusEffects(
  options: UseTaskDetailEventsOptions,
  state: TaskDetailEventsState
): void {
  useEffect(() => {
    if (options.taskStatus === "running" || options.taskStatus === "starting" || options.taskStatus === "queued") {
      return;
    }

    state.setIsThinking(false);
    state.setLiveToolCalls([]);
    state.setInterruptingLiveToolCallIds([]);
  }, [
    options.taskStatus,
    state.setInterruptingLiveToolCallIds,
    state.setIsThinking,
    state.setLiveToolCalls
  ]);

  useEffect(() => {
    state.setInterruptingLiveToolCallIds((current) =>
      current.filter((id) => state.liveToolCalls.some((call) => call.id === id))
    );
  }, [state.liveToolCalls, state.setInterruptingLiveToolCallIds]);
}

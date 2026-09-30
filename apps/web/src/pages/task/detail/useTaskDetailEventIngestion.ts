import { useCallback, useMemo } from "react";
import { selectPreferredContextUsage } from "@meowbert/shared/context-usage";
import { taskEventsUrl } from "../../../lib/api";
import { applyLiveToolEvent, deriveLiveToolCalls } from "../../../task/liveToolCalls";
import { appendEventsWithCap } from "../../../task/taskDetailWindowing";
import type { TaskContextUsage, TaskEventsPageResponse } from "../../../lib/types";
import {
  EVENT_CHUNK_SIZE,
  EVENT_LIVE_BUFFER_MAX_ITEMS,
  EVENT_MAX_WINDOW_ITEMS
} from "./taskDetailConstants";
import { parseIncomingTaskEvent } from "./taskDetailEventHelpers";
import {
  advanceTaskEventCursor,
  getNewestTaskEventCursor,
  shouldRefreshTaskSnapshotForEventType
} from "./taskDetailEventSync";
import type { TaskDetailEventsState, UseTaskDetailEventsOptions } from "./taskDetailEventTypes";

function useTaskEventPageFetcher(options: UseTaskDetailEventsOptions) {
  return useCallback(async (input: {
    direction: "older" | "newer";
    limit?: number;
    cursor?: { createdAt: string; id: string } | null;
  }): Promise<TaskEventsPageResponse> => {
    const query = new URLSearchParams();
    query.set("direction", input.direction);
    query.set("limit", String(input.limit ?? EVENT_CHUNK_SIZE));
    if (input.cursor) {
      query.set("cursorCreatedAt", input.cursor.createdAt);
      query.set("cursorId", input.cursor.id);
    }

    return options.api.get<TaskEventsPageResponse>(`/api/tasks/${options.taskId}/events?${query.toString()}`);
  }, [options.api, options.taskId]);
}

function useTaskLiveEventIngestion(
  options: UseTaskDetailEventsOptions,
  state: TaskDetailEventsState,
  scheduleTaskSnapshotRefresh: () => void
): {
  appendLiveEvent: (raw: unknown, fallbackType?: string) => void;
  ingestLiveEvent: (event: Parameters<typeof applyLiveToolEvent>[1]) => void;
} {
  const ingestLiveEvent = useCallback((event: Parameters<typeof applyLiveToolEvent>[1]): void => {
    state.lastSeenEventCursorRef.current = advanceTaskEventCursor(state.lastSeenEventCursorRef.current, event);

    state.setLiveToolCalls((current) => {
      const next = applyLiveToolEvent(current, event);
      return next.slice(Math.max(0, next.length - 8));
    });

    const shouldBufferLiveEvent = state.activeTabRef.current === "events" && !state.eventsNearBottomRef.current;
    if (shouldBufferLiveEvent) {
      state.setPendingLiveEvents((current) =>
        appendEventsWithCap(current, [event], EVENT_LIVE_BUFFER_MAX_ITEMS)
      );
      state.setEventsHasNewer(true);
    } else {
      if (state.eventsRef.current.length >= EVENT_MAX_WINDOW_ITEMS) {
        state.setEventsHasOlder(true);
      }
      state.setEvents((current) => appendEventsWithCap(current, [event], EVENT_MAX_WINDOW_ITEMS));
      state.setEventsHasNewer(false);
      if (state.activeTabRef.current === "events" && state.eventsNearBottomRef.current) {
        state.pendingEventsBottomAlignRef.current = true;
      }
    }

    if (event.type === "thinking_start") {
      state.setIsThinking(true);
    } else if (event.type === "thinking_end") {
      state.setIsThinking(false);
    } else if (event.type === "context_usage") {
      const nextUsage = {
        ...event.payload,
        createdAt: event.createdAt
      } as TaskContextUsage;

      options.setTaskDetail((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          latest_context_usage: selectPreferredContextUsage(current.latest_context_usage ?? null, nextUsage)
        };
      });
    } else if (
      event.type === "command_end"
      || event.type === "status"
      || event.type === "error"
      || event.type === "compaction"
    ) {
      state.setIsThinking(false);
    }

    if (event.type === "status" && typeof event.payload.status === "string") {
      const nextStatus = event.payload.status;
      options.setTaskDetail((current) => {
        if (!current || current.task.status === nextStatus) {
          return current;
        }

        return {
          ...current,
          task: {
            ...current.task,
            status: nextStatus,
            updated_at: event.createdAt
          }
        };
      });
    }

    if (shouldRefreshTaskSnapshotForEventType(event.type)) {
      scheduleTaskSnapshotRefresh();
    }
  }, [
    options.setTaskDetail,
    scheduleTaskSnapshotRefresh,
    state.activeTabRef,
    state.eventsNearBottomRef,
    state.eventsRef,
    state.lastSeenEventCursorRef,
    state.pendingEventsBottomAlignRef,
    state.setEvents,
    state.setEventsHasNewer,
    state.setEventsHasOlder,
    state.setIsThinking,
    state.setLiveToolCalls,
    state.setPendingLiveEvents
  ]);

  const appendLiveEvent = useCallback((raw: unknown, fallbackType?: string) => {
    const event = parseIncomingTaskEvent(raw, fallbackType);
    if (!event) {
      return;
    }

    ingestLiveEvent(event);
  }, [ingestLiveEvent]);

  return {
    appendLiveEvent,
    ingestLiveEvent
  };
}

function useTaskEventCatchUp(
  options: UseTaskDetailEventsOptions,
  state: TaskDetailEventsState,
  fetchEventsPage: (input: {
    direction: "older" | "newer";
    limit?: number;
    cursor?: { createdAt: string; id: string } | null;
  }) => Promise<TaskEventsPageResponse>,
  ingestLiveEvent: (event: Parameters<typeof applyLiveToolEvent>[1]) => void
) {
  const catchUpMissedEvents = useCallback(async (): Promise<void> => {
    if (!options.taskId || state.eventsCatchUpInFlightRef.current) {
      return;
    }

    let cursor = state.lastSeenEventCursorRef.current;
    if (!cursor) {
      return;
    }

    state.eventsCatchUpInFlightRef.current = true;
    try {
      while (cursor) {
        const page = await fetchEventsPage({
          direction: "newer",
          limit: EVENT_CHUNK_SIZE,
          cursor
        });
        if (state.activeTaskIdRef.current !== options.taskId) {
          return;
        }
        if (page.items.length === 0) {
          return;
        }

        for (const event of page.items) {
          ingestLiveEvent(event);
        }

        const pageCursor = getNewestTaskEventCursor(page.items);
        cursor = advanceTaskEventCursor(state.lastSeenEventCursorRef.current, pageCursor);
        if (!page.hasMore) {
          return;
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      state.eventsCatchUpInFlightRef.current = false;
    }
  }, [fetchEventsPage, ingestLiveEvent, options.taskId, state.activeTaskIdRef, state.eventsCatchUpInFlightRef, state.lastSeenEventCursorRef]);

  return catchUpMissedEvents;
}

function useTaskInitialEventLoad(
  options: UseTaskDetailEventsOptions,
  state: TaskDetailEventsState,
  fetchEventsPage: (input: {
    direction: "older" | "newer";
    limit?: number;
    cursor?: { createdAt: string; id: string } | null;
  }) => Promise<TaskEventsPageResponse>,
  catchUpMissedEvents: () => Promise<void>
) {
  const loadInitialEvents = useCallback(async (): Promise<void> => {
    if (!options.taskId) {
      return;
    }

    state.setIsEventsBootstrapping(true);
    try {
      const initialPage = await fetchEventsPage({ direction: "older", limit: EVENT_CHUNK_SIZE });
      if (state.activeTaskIdRef.current !== options.taskId) {
        return;
      }

      state.lastSeenEventCursorRef.current = getNewestTaskEventCursor(initialPage.items);
      state.setEvents(initialPage.items);
      state.setLiveToolCalls(deriveLiveToolCalls(initialPage.items));
      state.setEventsHasOlder(initialPage.hasMore);
      state.setEventsHasNewer(false);
      state.setPendingLiveEvents([]);
      state.eventsNearBottomRef.current = true;
      state.pendingEventsBottomAlignRef.current = false;

      void catchUpMissedEvents();
    } catch (err) {
      console.error(err);
    } finally {
      if (state.activeTaskIdRef.current === options.taskId) {
        state.setIsEventsBootstrapping(false);
      }
    }
  }, [
    catchUpMissedEvents,
    fetchEventsPage,
    options.taskId,
    state.activeTaskIdRef,
    state.eventsNearBottomRef,
    state.lastSeenEventCursorRef,
    state.pendingEventsBottomAlignRef,
    state.setEvents,
    state.setEventsHasNewer,
    state.setEventsHasOlder,
    state.setIsEventsBootstrapping,
    state.setLiveToolCalls,
    state.setPendingLiveEvents
  ]);

  return loadInitialEvents;
}

export function useTaskDetailEventIngestion(
  options: UseTaskDetailEventsOptions,
  state: TaskDetailEventsState,
  scheduleTaskSnapshotRefresh: () => void
): {
  appendLiveEvent: (raw: unknown, fallbackType?: string) => void;
  catchUpMissedEvents: () => Promise<void>;
  fetchEventsPage: (input: {
    direction: "older" | "newer";
    limit?: number;
    cursor?: { createdAt: string; id: string } | null;
  }) => Promise<TaskEventsPageResponse>;
  loadInitialEvents: () => Promise<void>;
  streamUrl: URL;
} {
  const fetchEventsPage = useTaskEventPageFetcher(options);
  const { appendLiveEvent, ingestLiveEvent } = useTaskLiveEventIngestion(
    options,
    state,
    scheduleTaskSnapshotRefresh
  );
  const catchUpMissedEvents = useTaskEventCatchUp(options, state, fetchEventsPage, ingestLiveEvent);
  const loadInitialEvents = useTaskInitialEventLoad(
    options,
    state,
    fetchEventsPage,
    catchUpMissedEvents
  );

  const streamUrl = useMemo(() => {
    const nextStreamUrl = new URL(taskEventsUrl(options.taskId));
    nextStreamUrl.searchParams.set("replayLimit", "0");
    return nextStreamUrl;
  }, [options.taskId]);

  return {
    appendLiveEvent,
    catchUpMissedEvents,
    fetchEventsPage,
    loadInitialEvents,
    streamUrl
  };
}

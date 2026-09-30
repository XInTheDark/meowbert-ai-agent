import { useCallback } from "react";
import { appendEventsWithCap, prependEventsWithCap } from "../../../task/taskDetailWindowing";
import type { LiveToolCall } from "../../../lib/types";
import { interruptTaskCommand } from "./taskDetailMutations";
import {
  EVENT_CHUNK_SIZE,
  EVENT_MAX_WINDOW_ITEMS,
  NEAR_BOTTOM_THRESHOLD_PX,
  SCROLL_EDGE_THRESHOLD_PX
} from "./taskDetailConstants";
import { advanceTaskEventCursor, getNewestTaskEventCursor } from "./taskDetailEventSync";
import type { TaskDetailEventsState, UseTaskDetailEventsOptions } from "./taskDetailEventTypes";
import { distanceFromBottom } from "./taskDetailUtils";

async function loadOlderEventsPage(input: {
  fetchEventsPage: (input: {
    direction: "older" | "newer";
    limit?: number;
    cursor?: { createdAt: string; id: string } | null;
  }) => Promise<{
    items: import("../../../lib/types").LiveEvent[];
    hasMore: boolean;
  }>;
  state: TaskDetailEventsState;
  taskId: string;
}): Promise<void> {
  if (input.state.eventsPaginationInFlightRef.current) {
    return;
  }

  const currentEvents = input.state.eventsRef.current;
  if (currentEvents.length === 0) {
    return;
  }

  const oldestEvent = currentEvents[0];
  if (!oldestEvent) {
    return;
  }

  input.state.eventsPaginationInFlightRef.current = true;
  input.state.setIsEventsPageLoading(true);
  try {
    const feed = input.state.eventsFeedRef.current;
    if (feed) {
      input.state.pendingEventsPrependRef.current = {
        scrollTop: feed.scrollTop,
        scrollHeight: feed.scrollHeight
      };
    }

    const page = await input.fetchEventsPage({
      direction: "older",
      limit: EVENT_CHUNK_SIZE,
      cursor: { createdAt: oldestEvent.createdAt, id: oldestEvent.id }
    });
    if (input.state.activeTaskIdRef.current !== input.taskId) {
      return;
    }
    input.state.setEvents((current) => prependEventsWithCap(current, page.items, EVENT_MAX_WINDOW_ITEMS));
    input.state.setEventsHasOlder(page.hasMore);
  } catch (err) {
    console.error(err);
  } finally {
    input.state.eventsPaginationInFlightRef.current = false;
    input.state.setIsEventsPageLoading(false);
  }
}

async function loadNewerEventsPage(input: {
  fetchEventsPage: (input: {
    direction: "older" | "newer";
    limit?: number;
    cursor?: { createdAt: string; id: string } | null;
  }) => Promise<{
    items: import("../../../lib/types").LiveEvent[];
    hasMore: boolean;
  }>;
  state: TaskDetailEventsState;
  taskId: string;
}): Promise<void> {
  if (input.state.eventsPaginationInFlightRef.current) {
    return;
  }

  const currentEvents = input.state.eventsRef.current;
  const newestEvent = currentEvents[currentEvents.length - 1];
  if (!newestEvent) {
    return;
  }

  input.state.eventsPaginationInFlightRef.current = true;
  input.state.setIsEventsPageLoading(true);
  try {
    const page = await input.fetchEventsPage({
      direction: "newer",
      limit: EVENT_CHUNK_SIZE,
      cursor: { createdAt: newestEvent.createdAt, id: newestEvent.id }
    });
    if (input.state.activeTaskIdRef.current !== input.taskId) {
      return;
    }

    const bufferedEvents = input.state.pendingLiveEventsRef.current;
    input.state.lastSeenEventCursorRef.current = advanceTaskEventCursor(
      input.state.lastSeenEventCursorRef.current,
      getNewestTaskEventCursor([...bufferedEvents, ...page.items])
    );
    if (input.state.eventsRef.current.length + bufferedEvents.length + page.items.length > EVENT_MAX_WINDOW_ITEMS) {
      input.state.setEventsHasOlder(true);
    }
    input.state.setEvents((current) =>
      appendEventsWithCap(current, [...bufferedEvents, ...page.items], EVENT_MAX_WINDOW_ITEMS)
    );
    input.state.setPendingLiveEvents([]);
    input.state.setEventsHasNewer(page.hasMore);
    if (input.state.eventsNearBottomRef.current) {
      input.state.pendingEventsBottomAlignRef.current = true;
    }
  } catch (err) {
    console.error(err);
  } finally {
    input.state.eventsPaginationInFlightRef.current = false;
    input.state.setIsEventsPageLoading(false);
  }
}

export function useTaskDetailEventActions(input: {
  options: UseTaskDetailEventsOptions;
  state: TaskDetailEventsState;
  fetchEventsPage: (input: {
    direction: "older" | "newer";
    limit?: number;
    cursor?: { createdAt: string; id: string } | null;
  }) => Promise<{
    items: import("../../../lib/types").LiveEvent[];
    hasMore: boolean;
  }>;
}): Pick<
  import("./taskDetailEventTypes").UseTaskDetailEventsResult,
  "activateEventsTab" | "handleEventsScroll" | "handleInterruptLiveToolCall"
> {
  const { options, state, fetchEventsPage } = input;

  const activateEventsTab = useCallback(() => {
    state.pendingEventsBottomAlignRef.current = true;
    state.eventsNearBottomRef.current = true;

    const bufferedEvents = state.pendingLiveEventsRef.current;
    if (bufferedEvents.length > 0) {
      if (state.eventsRef.current.length + bufferedEvents.length > EVENT_MAX_WINDOW_ITEMS) {
        state.setEventsHasOlder(true);
      }
      state.setEvents((current) => appendEventsWithCap(current, bufferedEvents, EVENT_MAX_WINDOW_ITEMS));
      state.setPendingLiveEvents([]);
      state.setEventsHasNewer(false);
    }
  }, [
    state.eventsNearBottomRef,
    state.eventsRef,
    state.pendingEventsBottomAlignRef,
    state.pendingLiveEventsRef,
    state.setEvents,
    state.setEventsHasNewer,
    state.setEventsHasOlder,
    state.setPendingLiveEvents
  ]);

  const handleEventsScroll = useCallback((): void => {
    const feed = state.eventsFeedRef.current;
    if (!feed) {
      return;
    }

    const nearBottom = distanceFromBottom(feed) <= NEAR_BOTTOM_THRESHOLD_PX;
    state.eventsNearBottomRef.current = nearBottom;

    const bufferedEvents = state.pendingLiveEventsRef.current;
    if (nearBottom && bufferedEvents.length > 0) {
      if (state.eventsRef.current.length + bufferedEvents.length > EVENT_MAX_WINDOW_ITEMS) {
        state.setEventsHasOlder(true);
      }
      state.setEvents((current) => appendEventsWithCap(current, bufferedEvents, EVENT_MAX_WINDOW_ITEMS));
      state.setPendingLiveEvents([]);
      state.setEventsHasNewer(false);
      state.pendingEventsBottomAlignRef.current = true;
      return;
    }

    if (state.isEventsBootstrapping || state.isEventsPageLoading) {
      return;
    }

    if (feed.scrollTop <= SCROLL_EDGE_THRESHOLD_PX && state.eventsHasOlder) {
      void loadOlderEventsPage({ fetchEventsPage, state, taskId: options.taskId });
      return;
    }

    if (nearBottom && (state.eventsHasNewer || bufferedEvents.length > 0)) {
      void loadNewerEventsPage({ fetchEventsPage, state, taskId: options.taskId });
    }
  }, [
    fetchEventsPage,
    options.taskId,
    state.eventsFeedRef,
    state.eventsHasNewer,
    state.eventsHasOlder,
    state.eventsNearBottomRef,
    state.eventsRef,
    state.isEventsBootstrapping,
    state.isEventsPageLoading,
    state.pendingEventsBottomAlignRef,
    state.pendingLiveEventsRef,
    state.setEvents,
    state.setEventsHasNewer,
    state.setEventsHasOlder,
    state.setPendingLiveEvents
  ]);

  const handleInterruptLiveToolCall = useCallback(async (liveCall: LiveToolCall): Promise<void> => {
    if (!options.taskId || liveCall.step === null) {
      return;
    }

    state.setInterruptingLiveToolCallIds((current) => {
      if (current.includes(liveCall.id)) {
        return current;
      }
      return [...current, liveCall.id];
    });

    try {
      await interruptTaskCommand(options.api, options.taskId, liveCall.step);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      options.onError(message);
      state.setInterruptingLiveToolCallIds((current) => current.filter((id) => id !== liveCall.id));
    }
  }, [options.api, options.onError, options.taskId, state.setInterruptingLiveToolCallIds]);

  return {
    activateEventsTab,
    handleEventsScroll,
    handleInterruptLiveToolCall
  };
}

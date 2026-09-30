import { useTaskDetailEventActions } from "./useTaskDetailEventActions";
import { useTaskDetailEventEffects } from "./useTaskDetailEventEffects";
import { useTaskDetailEventIngestion } from "./useTaskDetailEventIngestion";
import { useTaskDetailEventRefresh } from "./useTaskDetailEventRefresh";
import { useTaskDetailEventState } from "./useTaskDetailEventState";
import type { UseTaskDetailEventsOptions, UseTaskDetailEventsResult } from "./taskDetailEventTypes";

export function useTaskDetailEvents(options: UseTaskDetailEventsOptions): UseTaskDetailEventsResult {
  const state = useTaskDetailEventState(options);
  const scheduleTaskSnapshotRefresh = useTaskDetailEventRefresh(options.loadTaskSnapshot);
  const ingestion = useTaskDetailEventIngestion(options, state, scheduleTaskSnapshotRefresh);
  const actions = useTaskDetailEventActions({
    options,
    state,
    fetchEventsPage: ingestion.fetchEventsPage
  });

  useTaskDetailEventEffects({
    options,
    state,
    appendLiveEvent: ingestion.appendLiveEvent,
    catchUpMissedEvents: ingestion.catchUpMissedEvents,
    loadInitialEvents: ingestion.loadInitialEvents,
    streamUrl: ingestion.streamUrl
  });

  return {
    events: state.events,
    notificationEvents: state.notificationEvents,
    isEventsBootstrapping: state.isEventsBootstrapping,
    isEventsPageLoading: state.isEventsPageLoading,
    liveToolCalls: state.liveToolCalls,
    interruptingLiveToolCallIds: state.interruptingLiveToolCallIds,
    isThinking: state.isThinking,
    eventsFeedRef: state.eventsFeedRef,
    activateEventsTab: actions.activateEventsTab,
    handleEventsScroll: actions.handleEventsScroll,
    handleInterruptLiveToolCall: actions.handleInterruptLiveToolCall
  };
}

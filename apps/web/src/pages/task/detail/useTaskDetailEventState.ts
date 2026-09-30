import { useEffect, useMemo, useRef, useState } from "react";
import { buildEventWindowKey } from "../../../task/taskDetailWindowing";
import type { LiveEvent, LiveToolCall } from "../../../lib/types";
import type { TaskDetailEventsState, UseTaskDetailEventsOptions } from "./taskDetailEventTypes";

export function useTaskDetailEventState(options: UseTaskDetailEventsOptions): TaskDetailEventsState {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [eventsHasOlder, setEventsHasOlder] = useState(false);
  const [eventsHasNewer, setEventsHasNewer] = useState(false);
  const [pendingLiveEvents, setPendingLiveEvents] = useState<LiveEvent[]>([]);
  const [isEventsBootstrapping, setIsEventsBootstrapping] = useState(false);
  const [isEventsPageLoading, setIsEventsPageLoading] = useState(false);
  const [liveToolCalls, setLiveToolCalls] = useState<LiveToolCall[]>([]);
  const [interruptingLiveToolCallIds, setInterruptingLiveToolCallIds] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const eventsFeedRef = useRef<HTMLDivElement>(null);
  const eventsNearBottomRef = useRef(true);
  const eventsRef = useRef<LiveEvent[]>([]);
  const pendingLiveEventsRef = useRef<LiveEvent[]>([]);
  const activeTabRef = useRef(options.activeTab);
  const pendingEventsBottomAlignRef = useRef(false);
  const pendingEventsPrependRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const eventsPaginationInFlightRef = useRef(false);
  const activeTaskIdRef = useRef(options.taskId);
  const lastSeenEventCursorRef = useRef<{ createdAt: string; id: string } | null>(null);
  const eventsCatchUpInFlightRef = useRef(false);

  const notificationEvents = useMemo(
    () => events.filter((event) => event.type === "notification"),
    [events]
  );
  const eventsWindowKey = useMemo(() => buildEventWindowKey(events), [events]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    pendingLiveEventsRef.current = pendingLiveEvents;
  }, [pendingLiveEvents]);

  useEffect(() => {
    activeTabRef.current = options.activeTab;
  }, [options.activeTab]);

  useEffect(() => {
    activeTaskIdRef.current = options.taskId;
  }, [options.taskId]);

  return {
    events,
    setEvents,
    eventsHasOlder,
    setEventsHasOlder,
    eventsHasNewer,
    setEventsHasNewer,
    pendingLiveEvents,
    setPendingLiveEvents,
    isEventsBootstrapping,
    setIsEventsBootstrapping,
    isEventsPageLoading,
    setIsEventsPageLoading,
    liveToolCalls,
    setLiveToolCalls,
    interruptingLiveToolCallIds,
    setInterruptingLiveToolCallIds,
    isThinking,
    setIsThinking,
    notificationEvents,
    eventsWindowKey,
    eventsFeedRef,
    eventsNearBottomRef,
    eventsRef,
    pendingLiveEventsRef,
    activeTabRef,
    pendingEventsBottomAlignRef,
    pendingEventsPrependRef,
    eventsPaginationInFlightRef,
    activeTaskIdRef,
    lastSeenEventCursorRef,
    eventsCatchUpInFlightRef
  };
}

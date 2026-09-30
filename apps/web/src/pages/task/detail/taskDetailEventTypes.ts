import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { ApiClient } from "../../../lib/api";
import type { LiveEvent, LiveToolCall, TaskDetail } from "../../../lib/types";
import type { TaskDetailTab } from "./taskDetailConstants";
import type { TaskEventCursor } from "./taskDetailEventSync";

export interface UseTaskDetailEventsOptions {
  api: ApiClient;
  taskId: string;
  token: string | null;
  activeTab: TaskDetailTab;
  taskStatus: string | undefined;
  loadTaskSnapshot: () => Promise<void>;
  setTaskDetail: Dispatch<SetStateAction<TaskDetail | null>>;
  onError: (message: string) => void;
}

export interface UseTaskDetailEventsResult {
  events: LiveEvent[];
  notificationEvents: LiveEvent[];
  isEventsBootstrapping: boolean;
  isEventsPageLoading: boolean;
  liveToolCalls: LiveToolCall[];
  interruptingLiveToolCallIds: string[];
  isThinking: boolean;
  eventsFeedRef: RefObject<HTMLDivElement>;
  activateEventsTab: () => void;
  handleEventsScroll: () => void;
  handleInterruptLiveToolCall: (liveCall: LiveToolCall) => Promise<void>;
}

export interface TaskDetailEventsState {
  events: LiveEvent[];
  setEvents: Dispatch<SetStateAction<LiveEvent[]>>;
  eventsHasOlder: boolean;
  setEventsHasOlder: Dispatch<SetStateAction<boolean>>;
  eventsHasNewer: boolean;
  setEventsHasNewer: Dispatch<SetStateAction<boolean>>;
  pendingLiveEvents: LiveEvent[];
  setPendingLiveEvents: Dispatch<SetStateAction<LiveEvent[]>>;
  isEventsBootstrapping: boolean;
  setIsEventsBootstrapping: Dispatch<SetStateAction<boolean>>;
  isEventsPageLoading: boolean;
  setIsEventsPageLoading: Dispatch<SetStateAction<boolean>>;
  liveToolCalls: LiveToolCall[];
  setLiveToolCalls: Dispatch<SetStateAction<LiveToolCall[]>>;
  interruptingLiveToolCallIds: string[];
  setInterruptingLiveToolCallIds: Dispatch<SetStateAction<string[]>>;
  isThinking: boolean;
  setIsThinking: Dispatch<SetStateAction<boolean>>;
  notificationEvents: LiveEvent[];
  eventsWindowKey: string;
  eventsFeedRef: RefObject<HTMLDivElement>;
  eventsNearBottomRef: MutableRefObject<boolean>;
  eventsRef: MutableRefObject<LiveEvent[]>;
  pendingLiveEventsRef: MutableRefObject<LiveEvent[]>;
  activeTabRef: MutableRefObject<TaskDetailTab>;
  pendingEventsBottomAlignRef: MutableRefObject<boolean>;
  pendingEventsPrependRef: MutableRefObject<{ scrollTop: number; scrollHeight: number } | null>;
  eventsPaginationInFlightRef: MutableRefObject<boolean>;
  activeTaskIdRef: MutableRefObject<string>;
  lastSeenEventCursorRef: MutableRefObject<TaskEventCursor | null>;
  eventsCatchUpInFlightRef: MutableRefObject<boolean>;
}

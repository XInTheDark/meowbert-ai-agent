import type { LiveEvent } from "../../../lib/types";

export interface TaskEventCursor {
  createdAt: string;
  id: string;
}

export interface CoalescedRefreshController {
  schedule: () => void;
  cancel: () => void;
}

const TASK_SNAPSHOT_REFRESH_EVENT_TYPES = new Set([
  "status",
  "error",
  "command_end",
  "compaction",
  "notification"
]);

export function compareTaskEventCursors(a: TaskEventCursor, b: TaskEventCursor): number {
  if (a.createdAt < b.createdAt) {
    return -1;
  }
  if (a.createdAt > b.createdAt) {
    return 1;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

export function toTaskEventCursor(
  event: Pick<LiveEvent, "createdAt" | "id"> | TaskEventCursor | null | undefined
): TaskEventCursor | null {
  if (!event) {
    return null;
  }

  return {
    createdAt: event.createdAt,
    id: event.id
  };
}

export function advanceTaskEventCursor(
  current: TaskEventCursor | null,
  incoming: Pick<LiveEvent, "createdAt" | "id"> | TaskEventCursor | null | undefined
): TaskEventCursor | null {
  const next = toTaskEventCursor(incoming);
  if (!next) {
    return current;
  }
  if (!current || compareTaskEventCursors(current, next) < 0) {
    return next;
  }
  return current;
}

export function getNewestTaskEventCursor(
  events: Array<Pick<LiveEvent, "createdAt" | "id">>
): TaskEventCursor | null {
  let cursor: TaskEventCursor | null = null;
  for (const event of events) {
    cursor = advanceTaskEventCursor(cursor, event);
  }
  return cursor;
}

export function shouldRefreshTaskSnapshotForEventType(type: string): boolean {
  return TASK_SNAPSHOT_REFRESH_EVENT_TYPES.has(type);
}

export function createCoalescedRefreshController(
  run: () => Promise<void>,
  delayMs: number
): CoalescedRefreshController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let pending = false;
  let cancelled = false;

  const flush = async (): Promise<void> => {
    timer = null;
    if (cancelled) {
      return;
    }
    if (inFlight) {
      pending = true;
      return;
    }

    inFlight = true;
    try {
      await run();
    } finally {
      inFlight = false;
      if (cancelled || !pending) {
        pending = false;
        return;
      }

      pending = false;
      timer = setTimeout(() => {
        void flush();
      }, delayMs);
    }
  };

  return {
    schedule: () => {
      if (cancelled) {
        return;
      }
      if (inFlight) {
        pending = true;
        return;
      }
      if (timer !== null) {
        return;
      }
      timer = setTimeout(() => {
        void flush();
      }, delayMs);
    },
    cancel: () => {
      cancelled = true;
      pending = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }
  };
}

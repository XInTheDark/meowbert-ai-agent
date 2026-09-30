import type { LiveEvent, TaskMessage } from "../lib/types";

export interface WindowRange {
  start: number;
  end: number;
}

export function rangesEqual(a: WindowRange, b: WindowRange): boolean {
  return a.start === b.start && a.end === b.end;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }

  return true;
}

export function isPathAppendOnly(previousPathIds: string[], nextPathIds: string[]): boolean {
  if (nextPathIds.length < previousPathIds.length) {
    return false;
  }

  for (let index = 0; index < previousPathIds.length; index += 1) {
    if (previousPathIds[index] !== nextPathIds[index]) {
      return false;
    }
  }

  return true;
}

export function trimWindowToLimit(range: WindowRange, maxItems: number): WindowRange {
  if (range.end - range.start <= maxItems) {
    return range;
  }

  return {
    start: Math.max(0, range.end - maxItems),
    end: range.end
  };
}

export function buildTailWindow(totalItems: number, chunkSize: number, maxItems: number): WindowRange {
  if (totalItems <= 0) {
    return { start: 0, end: 0 };
  }

  const end = totalItems;
  const start = Math.max(0, end - chunkSize);
  return trimWindowToLimit({ start, end }, maxItems);
}

export function expandRangeToToolBoundaries(
  range: WindowRange,
  orderedMessageIds: string[],
  messagesById: Map<string, Pick<TaskMessage, "role">>
): WindowRange {
  const totalItems = orderedMessageIds.length;
  if (totalItems === 0) {
    return { start: 0, end: 0 };
  }

  let start = Math.max(0, Math.min(range.start, totalItems));
  let end = Math.max(start, Math.min(range.end, totalItems));

  while (start > 0) {
    const current = messagesById.get(orderedMessageIds[start]);
    const previous = messagesById.get(orderedMessageIds[start - 1]);
    if (current?.role !== "tool" || previous?.role !== "tool") {
      break;
    }
    start -= 1;
  }

  while (end < totalItems) {
    const current = messagesById.get(orderedMessageIds[end - 1]);
    const next = messagesById.get(orderedMessageIds[end]);
    if (current?.role !== "tool" || next?.role !== "tool") {
      break;
    }
    end += 1;
  }

  return { start, end };
}

export function collectConversationHydrationIds(
  messageIds: string[],
  messagesById: Map<string, Pick<TaskMessage, "role">>,
  requestedToolMessageIds: Set<string>
): string[] {
  const tailToolMessageIds = new Set<string>();
  for (let index = messageIds.length - 1; index >= 0; index -= 1) {
    const messageId = messageIds[index];
    const message = messagesById.get(messageId);
    if (message?.role !== "tool") {
      break;
    }
    tailToolMessageIds.add(messageId);
  }

  const hydrationIds: string[] = [];
  for (const messageId of messageIds) {
    const message = messagesById.get(messageId);
    if (!message) {
      continue;
    }

    if (
      message.role !== "tool"
      || requestedToolMessageIds.has(messageId)
      || tailToolMessageIds.has(messageId)
    ) {
      hydrationIds.push(messageId);
    }
  }

  return hydrationIds;
}

export function prependEventsWithCap(current: LiveEvent[], incoming: LiveEvent[], maxItems: number): LiveEvent[] {
  if (incoming.length === 0) {
    return current.slice(0, Math.min(current.length, maxItems));
  }

  const seen = new Set(current.map((event) => event.id));
  const uniqueIncoming = incoming.filter((event) => !seen.has(event.id));
  const merged = [...uniqueIncoming, ...current];
  if (merged.length <= maxItems) {
    return merged;
  }

  return merged.slice(0, maxItems);
}

export function appendEventsWithCap(current: LiveEvent[], incoming: LiveEvent[], maxItems: number): LiveEvent[] {
  if (incoming.length === 0) {
    return current.slice(Math.max(0, current.length - maxItems));
  }

  const seen = new Set(current.map((event) => event.id));
  const uniqueIncoming = incoming.filter((event) => !seen.has(event.id));
  const merged = [...current, ...uniqueIncoming];
  if (merged.length <= maxItems) {
    return merged;
  }

  return merged.slice(Math.max(0, merged.length - maxItems));
}

export function buildEventWindowKey(events: LiveEvent[]): string {
  if (events.length === 0) {
    return "0";
  }

  const firstId = events[0]?.id ?? "";
  const lastId = events[events.length - 1]?.id ?? "";
  return `${events.length}:${firstId}:${lastId}`;
}

export function countHydratedMessageIds(
  messageIds: string[],
  messageContentById: Record<string, unknown>
): number {
  let hydratedCount = 0;
  for (const messageId of messageIds) {
    if (messageContentById[messageId]) {
      hydratedCount += 1;
    }
  }

  return hydratedCount;
}

export function collectMissingMessageIds(
  messageIds: string[],
  messageContentById: Record<string, unknown>,
  inFlightIds: Set<string>
): string[] {
  const missing: string[] = [];
  for (const messageId of messageIds) {
    if (messageContentById[messageId] || inFlightIds.has(messageId)) {
      continue;
    }
    missing.push(messageId);
  }
  return missing;
}

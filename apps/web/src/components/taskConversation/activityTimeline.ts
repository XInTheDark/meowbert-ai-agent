import type { TaskMessage } from "../../lib/types";
import type { ActivityThought } from "./conversationActivityEntries";
import { getToolMessageCallId } from "./shared";

export type ActivityTimelineEntry =
  | { kind: "thought"; key: string; thoughts: ActivityThought[] }
  | { kind: "tool"; key: string; tool: TaskMessage; index: number };

// Places each thought just before the first tool call it preceded in its response, keeping tool order
// unchanged. Thoughts with no following call in this group go at the end; adjacent thoughts merge.
export function buildActivityTimeline(toolGroup: TaskMessage[], thoughts: ActivityThought[]): ActivityTimelineEntry[] {
  const groupCallIds = new Set(toolGroup.map(getToolMessageCallId).filter((callId): callId is string => callId !== null));
  const thoughtsByCallId = new Map<string, ActivityThought[]>();
  const trailing: ActivityThought[] = [];
  for (const thought of thoughts) {
    const anchor = thought.nextCallIds.find((callId) => groupCallIds.has(callId));
    if (anchor) {
      thoughtsByCallId.set(anchor, [...(thoughtsByCallId.get(anchor) ?? []), thought]);
    } else {
      trailing.push(thought);
    }
  }

  const entries: ActivityTimelineEntry[] = [];
  const pushThoughts = (items: ActivityThought[] | undefined): void => {
    if (items && items.length > 0) {
      entries.push({ kind: "thought", key: items[0].id, thoughts: items });
    }
  };
  toolGroup.forEach((tool, index) => {
    const callId = getToolMessageCallId(tool);
    pushThoughts(callId ? thoughtsByCallId.get(callId) : undefined);
    if (callId) {
      thoughtsByCallId.delete(callId);
    }
    entries.push({ kind: "tool", key: tool.id, tool, index });
  });
  pushThoughts(trailing);
  return entries;
}

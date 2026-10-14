import type { ConversationDisplayEntry } from "./conversationActivityEntries";
import { formatElapsedDuration } from "./shared";

export interface TurnWorkFold {
  key: string;
  title: string;
  callCount: number;
  // Activity groups inside the fold leave their notices outside it.
  items: ConversationEntryItem[];
}

export interface ConversationEntryItem {
  kind: "entry";
  entry: ConversationDisplayEntry;
  index: number;
  activityPart?: "tools" | "notices";
}

// Rendered in order: a fold, the outputs and notices it keeps visible, then the turn's answer.
export type ConversationRenderItem = ConversationEntryItem | { kind: "fold"; fold: TurnWorkFold };

function isUserEntry(entry: ConversationDisplayEntry): boolean {
  return entry.kind === "message" && entry.message.role === "user";
}

function findAnswerStart(entries: ConversationDisplayEntry[], start: number, end: number): number {
  let answerIndex = -1;
  for (let index = end - 1; index >= start; index -= 1) {
    const entry = entries[index];
    if (entry.kind === "message" && entry.message.role === "assistant") {
      answerIndex = index;
      break;
    }
  }
  if (answerIndex < 0) {
    return -1;
  }
  const answerId = (entries[answerIndex] as Extract<ConversationDisplayEntry, { kind: "message" }>).message.id;
  while (answerIndex > start) {
    const previous = entries[answerIndex - 1];
    if (!(previous.kind === "artifact" || (previous.kind === "message" && previous.message.id === answerId))) {
      break;
    }
    answerIndex -= 1;
  }
  return answerIndex;
}

function getFoldTitle(entries: ConversationDisplayEntry[], turnStart: number, answerStart: number): string {
  const from = entries[turnStart];
  const to = entries[answerStart];
  if (from.kind !== "message" || to.kind !== "message") {
    return "Worked";
  }
  const durationMs = new Date(to.message.created_at).getTime() - new Date(from.message.created_at).getTime();
  return Number.isFinite(durationMs) && durationMs > 0 ? `Worked for ${formatElapsedDuration(durationMs)}` : "Worked";
}

function buildTurnItems(entries: ConversationDisplayEntry[], start: number, end: number, canFold: boolean): ConversationRenderItem[] {
  const passthrough = (from: number, to: number): ConversationEntryItem[] =>
    entries.slice(from, to).map((entry, offset) => ({ kind: "entry", entry, index: from + offset }));
  const answerStart = canFold && isUserEntry(entries[start]) ? findAnswerStart(entries, start + 1, end) : -1;
  const working = answerStart > start ? entries.slice(start + 1, answerStart) : [];
  const activityCount = working.filter((entry) => entry.kind === "activity").length;
  const hasInterimText = working.some((entry) => entry.kind === "message");
  if (!hasInterimText && activityCount < 2) {
    return passthrough(start, end);
  }

  const kept: ConversationEntryItem[] = [];
  const folded: ConversationEntryItem[] = [];
  working.forEach((entry, offset) => {
    const index = start + 1 + offset;
    if (entry.kind === "artifact") {
      kept.push({ kind: "entry", entry, index });
      return;
    }
    if (entry.kind === "activity" && entry.notices.length > 0) {
      kept.push({ kind: "entry", entry, index, activityPart: "notices" });
    }
    if (entry.kind !== "activity" || entry.toolGroup.length > 0 || entry.thoughts.length > 0) {
      folded.push({ kind: "entry", entry, index, activityPart: entry.kind === "activity" ? "tools" : undefined });
    }
  });
  const answer = entries[answerStart] as Extract<ConversationDisplayEntry, { kind: "message" }>;
  const fold: TurnWorkFold = {
    key: `turn-work:${answer.message.id}`,
    title: getFoldTitle(entries, start, answerStart),
    callCount: working.reduce((count, entry) => count + (entry.kind === "activity" ? entry.toolGroup.length : 0), 0),
    items: folded
  };
  return [...passthrough(start, start + 1), { kind: "fold", fold }, ...kept, ...passthrough(answerStart, end)];
}

// Folds the work between a user message and its final answer into one row. The trailing turn of a
// running task stays open because its answer is not final yet.
export function buildConversationRenderItems(
  entries: ConversationDisplayEntry[],
  options: { foldFinishedTurns: boolean; isTaskRunning: boolean }
): ConversationRenderItem[] {
  const turnStarts = entries.flatMap((entry, index) => (index === 0 || isUserEntry(entry) ? [index] : []));
  return turnStarts.flatMap((start, turn) => {
    const end = turnStarts[turn + 1] ?? entries.length;
    const isTrailingRunningTurn = options.isTaskRunning && end === entries.length;
    return buildTurnItems(entries, start, end, options.foldFinishedTurns && !isTrailingRunningTurn);
  });
}

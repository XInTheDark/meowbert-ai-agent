export const MAX_DELTA_MESSAGES = 120;
export const MAX_DELTA_CHARS = 120_000;
export const MAX_DELTA_MESSAGE_CHARS = 12_000;

export interface MemoryDeltaMessage {
  role: "user" | "assistant";
  text: string;
  created_at: string | Date;
  task_title: string | null;
}

export interface MemoryDelta {
  markdown: string;
  throughAt: string | Date | null;
}

function toTime(value: string | Date): number {
  return new Date(value).getTime();
}

function formatEntry(message: MemoryDeltaMessage): string | null {
  const text = message.text.trim();
  if (!text) {
    return null;
  }
  const author = message.role === "user" ? "User" : "Agent";
  const heading = `## ${author} · ${new Date(message.created_at).toISOString()}${message.task_title ? ` · ${message.task_title}` : ""}`;
  const body = text.length > MAX_DELTA_MESSAGE_CHARS
    ? `${text.slice(0, MAX_DELTA_MESSAGE_CHARS)}\n\n[Truncated]`
    : text;
  return `${heading}\n\n${body}\n`;
}

// Stops at the character budget and reports the last message actually included, so the
// cursor never moves past messages that did not make it into this refresh.
export function buildMemoryDelta(messages: MemoryDeltaMessage[]): MemoryDelta {
  const entries = ["# Conversation delta", ""];
  let remaining = MAX_DELTA_CHARS;
  let throughAt: string | Date | null = null;

  for (const message of messages) {
    const entry = formatEntry(message);
    const sharesCursorTime = throughAt !== null && toTime(message.created_at) === toTime(throughAt);
    if (entry && entry.length > remaining && throughAt !== null && !sharesCursorTime) {
      break;
    }
    if (entry) {
      entries.push(entry);
      remaining -= entry.length;
    }
    throughAt = message.created_at;
  }

  return { markdown: entries.join("\n"), throughAt };
}

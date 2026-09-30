import type { TaskMessage } from "../../../lib/types";
import { getMessageText } from "../../../lib/utils";

export interface TaskMessageOutlineItem {
  id: string;
  index: number;
  preview: string;
  hoverPreview: string;
  label: string;
  role: "user" | "assistant";
}

export interface TaskMessageOutlineVirtualWindow {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
}

export const TASK_MESSAGE_OUTLINE_ROW_HEIGHT = 92;
export const TASK_MESSAGE_OUTLINE_OVERSCAN = 8;

function truncateOutlinePreview(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}…`;
}

function buildMessageOutlinePreview(message: TaskMessage): string {
  const hasDirectText = typeof message.content_json.text === "string" && message.content_json.text.trim().length > 0;
  const hasStructuredContent = Object.keys(message.content_json).length > 0;
  if (!hasDirectText && !hasStructuredContent) {
    return message.role === "assistant"
      ? "Preview loads when this reply is in view."
      : "Preview loads when this message is in view.";
  }

  const normalized = getMessageText(message)
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/[`*_>#~-]/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length > 0) {
    return normalized;
  }

  return message.role === "assistant" ? "Assistant response" : "Your message";
}

export function buildTaskMessageOutlineItems(messages: TaskMessage[]): TaskMessageOutlineItem[] {
  return messages
    .filter((message): message is TaskMessage & { role: "user" | "assistant" } => (
      message.role === "user" || message.role === "assistant"
    ))
    .map((message, index) => {
      const normalizedPreview = buildMessageOutlinePreview(message);
      return {
        id: message.id,
        index: index + 1,
        preview: truncateOutlinePreview(normalizedPreview, 92),
        hoverPreview: truncateOutlinePreview(normalizedPreview, 280),
        label: message.role === "assistant" ? "Assistant" : "You",
        role: message.role
      };
    });
}

export function resolveActiveOutlineMessageId(
  feed: HTMLDivElement,
  outlineItemIdSet: Set<string>
): string | null {
  const viewportAnchor = feed.scrollTop + Math.min(feed.clientHeight * 0.24, 180);
  const renderedMessages = feed.querySelectorAll<HTMLElement>("[data-message-id]");
  let firstRenderedMessageId: string | null = null;
  let activeMessageId: string | null = null;

  for (const renderedMessage of renderedMessages) {
    const messageId = renderedMessage.dataset.messageId;
    if (!messageId || !outlineItemIdSet.has(messageId)) {
      continue;
    }

    if (firstRenderedMessageId === null) {
      firstRenderedMessageId = messageId;
    }

    if (renderedMessage.offsetTop <= viewportAnchor) {
      activeMessageId = messageId;
      continue;
    }

    break;
  }

  return activeMessageId ?? firstRenderedMessageId;
}

export function getTaskMessageOutlineVirtualWindow(input: {
  scrollTop: number;
  viewportHeight: number;
  totalItems: number;
  rowHeight?: number;
  overscan?: number;
}): TaskMessageOutlineVirtualWindow {
  const rowHeight = input.rowHeight ?? TASK_MESSAGE_OUTLINE_ROW_HEIGHT;
  const overscan = input.overscan ?? TASK_MESSAGE_OUTLINE_OVERSCAN;
  const totalHeight = input.totalItems * rowHeight;

  if (input.totalItems === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      totalHeight
    };
  }

  const viewportBottom = input.scrollTop + Math.max(input.viewportHeight, rowHeight);
  const startIndex = Math.max(0, Math.floor(input.scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    input.totalItems,
    Math.ceil(viewportBottom / rowHeight) + overscan
  );

  return {
    startIndex,
    endIndex,
    totalHeight
  };
}

export function getTaskMessageOutlineScrollTopForIndex(index: number, rowHeight = TASK_MESSAGE_OUTLINE_ROW_HEIGHT): number {
  return Math.max(0, index * rowHeight);
}

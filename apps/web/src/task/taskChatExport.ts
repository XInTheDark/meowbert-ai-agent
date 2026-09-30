import type { ApiClient } from "../lib/api";
import type { TaskConversationPageResponse, TaskDetail, TaskMessage } from "../lib/types";

const EXPORT_PAGE_SIZE = 200;

export type TaskChatExportFormat = "json" | "md";

interface TaskChatExportInput {
  api: ApiClient;
  taskId: string;
  activeLeafMessageId: string | null;
}

interface TaskChatExportPayloadInput {
  task: TaskDetail["task"];
  activeLeafMessageId: string | null;
  messages: TaskMessage[];
  exportedAt: string;
  format: TaskChatExportFormat;
}

export interface TaskChatExportBuildResult {
  filename: string;
  mimeType: string;
  content: string;
  messageCount: number;
}

interface ExportableTaskMessage {
  id: string;
  role: Exclude<TaskMessage["role"], "tool">;
  content: string;
  created_at: string;
  parent_message_id: string | null;
  edited_from_message_id: string | null;
  message_metadata_json?: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMaybeJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractOutputTextFromMessageItem(item: Record<string, unknown>): string[] {
  const content = item.content;
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return null;
      }
      return typeof part.text === "string" && (part.type === "output_text" || part.type === "text")
        ? part.text
        : null;
    })
    .filter((part): part is string => typeof part === "string" && part.length > 0);
}

function extractFinalResponseText(item: Record<string, unknown>): string | null {
  if (item.type !== "function_call" || item.name !== "final_response" || typeof item.arguments !== "string") {
    return null;
  }

  const parsed = parseMaybeJson(item.arguments);
  return isRecord(parsed) && typeof parsed.response === "string" ? parsed.response : null;
}

function hasFinalResponseText(item: Record<string, unknown>): boolean {
  return item.type === "function_call" && item.name === "final_response" && typeof item.arguments === "string";
}

function extractFinalResponseTexts(responseItems: unknown[]): string[] {
  const finalResponseTexts: string[] = [];
  for (const item of responseItems) {
    if (!isRecord(item) || !hasFinalResponseText(item)) {
      continue;
    }

    const finalResponseText = extractFinalResponseText(item);
    if (finalResponseText && finalResponseText.trim().length > 0) {
      finalResponseTexts.push(finalResponseText.trim());
    }
  }

  return finalResponseTexts;
}

export function extractTaskChatMessageText(message: TaskMessage): string {
  if (typeof message.content_json.text === "string") {
    return message.content_json.text;
  }

  if (typeof message.content_json.summary_markdown === "string") {
    return message.content_json.summary_markdown;
  }

  if (typeof message.content_json.output_text === "string") {
    return message.content_json.output_text;
  }

  const responseItems = message.content_json.response_items;
  if (!Array.isArray(responseItems)) {
    return "";
  }

  const finalResponseTexts = extractFinalResponseTexts(responseItems);
  if (finalResponseTexts.length > 0) {
    return finalResponseTexts[finalResponseTexts.length - 1];
  }

  const textParts: string[] = [];
  for (const item of responseItems) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.type === "message") {
      textParts.push(...extractOutputTextFromMessageItem(item));
      continue;
    }

    if (item.type === "output_text" && typeof item.text === "string") {
      textParts.push(item.text);
      continue;
    }

  }

  return textParts.join("\n\n");
}

function toExportableMessages(messages: TaskMessage[]): ExportableTaskMessage[] {
  return messages
    .filter((message): message is TaskMessage & { role: Exclude<TaskMessage["role"], "tool"> } => message.role !== "tool")
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: extractTaskChatMessageText(message),
      created_at: message.created_at,
      parent_message_id: message.parent_message_id,
      edited_from_message_id: message.edited_from_message_id,
      ...(message.message_metadata_json ? { message_metadata_json: message.message_metadata_json } : {})
    }))
    .filter((message) => message.content.trim().length > 0);
}

function buildConversationPath(taskId: string, activeLeafMessageId: string | null, beforeIndex?: number): string {
  const params = new URLSearchParams({ limit: String(EXPORT_PAGE_SIZE) });
  if (activeLeafMessageId) {
    params.set("activeLeafMessageId", activeLeafMessageId);
  }
  if (typeof beforeIndex === "number") {
    params.set("beforeIndex", String(beforeIndex));
  }
  return `/api/tasks/${taskId}/conversation?${params.toString()}`;
}

export async function fetchTaskChatExportMessages(input: TaskChatExportInput): Promise<{
  activeLeafMessageId: string | null;
  messages: TaskMessage[];
}> {
  let beforeIndex: number | undefined;
  let activeLeafMessageId = input.activeLeafMessageId;
  const pages: TaskMessage[][] = [];

  for (let guard = 0; guard < 1000; guard += 1) {
    const response = await input.api.get<TaskConversationPageResponse>(
      buildConversationPath(input.taskId, activeLeafMessageId, beforeIndex)
    );
    activeLeafMessageId = response.active_leaf_message_id;
    pages.unshift(response.messages);

    if (!response.message_page.has_older) {
      break;
    }
    beforeIndex = response.message_page.start_index;
  }

  return {
    activeLeafMessageId,
    messages: pages.flat()
  };
}

function sanitizeFilenamePart(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized && normalized.length > 0 ? normalized.slice(0, 80) : "task";
}

function buildExportFilename(task: TaskDetail["task"], exportedAt: string, format: TaskChatExportFormat): string {
  const datePart = exportedAt.replace(/[:.]/g, "-");
  return `${sanitizeFilenamePart(task.title ?? task.id)}-chat-${datePart}.${format === "json" ? "json" : "md"}`;
}

function buildMarkdownExport(messages: ExportableTaskMessage[]): string {
  return messages
    .map((message) => `## ${message.role.charAt(0).toUpperCase()}${message.role.slice(1)}\n\n${message.content.trim()}`)
    .join("\n\n");
}

function buildJsonExport(input: TaskChatExportPayloadInput, messages: ExportableTaskMessage[]): string {
  return JSON.stringify({
    metadata: {
      version: 1,
      exported_at: input.exportedAt,
      format: input.format,
      task: {
        id: input.task.id,
        title: input.task.title,
        status: input.task.status,
        source: input.task.source,
        created_at: input.task.created_at,
        updated_at: input.task.updated_at,
        completed_at: input.task.completed_at ?? null,
        task_type: input.task.task_type ?? "standard"
      },
      active_leaf_message_id: input.activeLeafMessageId,
      message_count: messages.length
    },
    messages
  }, null, 2);
}

export function buildTaskChatExport(input: TaskChatExportPayloadInput): TaskChatExportBuildResult {
  const messages = toExportableMessages(input.messages);
  const content = input.format === "json"
    ? buildJsonExport(input, messages)
    : buildMarkdownExport(messages);

  return {
    filename: buildExportFilename(input.task, input.exportedAt, input.format),
    mimeType: input.format === "json" ? "application/json" : "text/markdown",
    content,
    messageCount: messages.length
  };
}

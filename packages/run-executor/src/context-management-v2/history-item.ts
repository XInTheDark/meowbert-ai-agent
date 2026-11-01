import type { ResponseInputItem } from "openai/resources/responses/responses";

// One history item as a line of its window's history file.
export interface HistoryFileLine {
  id: string;
  call_number: number | null;
  role: string;
  type: string | null;
  tool: string | null;
  content: string;
}

export interface HistoryItemMetadata {
  role: string;
  itemType: string | null;
  toolNamespace: string | null;
  toolName: string | null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function getHistoryMetadata(item: ResponseInputItem): HistoryItemMetadata {
  const record = getRecord(item);
  const type = typeof record.type === "string" ? record.type : null;
  const name = typeof record.name === "string" ? record.name : null;
  const [toolNamespace, toolName] = name?.includes(".") ? name.split(".", 2) : [null, name];
  return {
    role: typeof record.role === "string" ? record.role : (type?.endsWith("_output") ? "tool" : "assistant"),
    itemType: type,
    toolNamespace,
    toolName
  };
}

function partText(part: unknown): string {
  const record = getRecord(part);
  if (typeof record.text === "string") return record.text;
  if (typeof record.refusal === "string") return record.refusal;
  if (record.type === "input_image") return "[image]";
  if (record.type === "input_file") return `[file${typeof record.filename === "string" ? `: ${record.filename}` : ""}]`;
  return JSON.stringify(part);
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(partText).join("\n");
  return null;
}

// The readable text of an item: message text, call arguments or output, and reasoning summaries.
// Encrypted reasoning and image data are left out.
export function getHistoryItemContent(item: ResponseInputItem): string {
  const record = getRecord(item);
  switch (record.type) {
    case "function_call":
      return typeof record.arguments === "string" ? record.arguments : "";
    case "custom_tool_call":
      return typeof record.input === "string" ? record.input : "";
    case "reasoning":
      return textOf(record.summary) ?? "";
    default:
      return textOf(record.content) ?? textOf(record.output) ?? JSON.stringify(item);
  }
}

export function toHistoryFileLine(input: { id: string; callNumber: number | null; item: ResponseInputItem }): HistoryFileLine {
  const metadata = getHistoryMetadata(input.item);
  return {
    id: input.id,
    call_number: input.callNumber,
    role: metadata.role,
    type: metadata.itemType,
    tool: metadata.toolNamespace ? `${metadata.toolNamespace}.${metadata.toolName}` : metadata.toolName,
    content: getHistoryItemContent(input.item)
  };
}

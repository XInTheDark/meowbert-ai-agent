import { isPlainObject, parseImageDimensionsFromBuffer } from "@meowbert/shared";
import type { ResponseInputItem } from "openai/resources/responses/responses";

// Adapted from openai/codex core/src/context_manager/history.rs at 970111f6
// (Apache-2.0). Count model-visible UTF-8 bytes, without JSON transport framing.
const RESIZED_IMAGE_BYTES = 7_373;
const ORIGINAL_IMAGE_MAX_PATCHES = 10_000;

function textBytes(value: unknown): number {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}

function imageBytes(part: Record<string, unknown>): number {
  if (part.detail !== "original") return RESIZED_IMAGE_BYTES;
  if (typeof part.file_id === "string") return ORIGINAL_IMAGE_MAX_PATCHES * 4;
  const url = typeof part.image_url === "string" ? part.image_url : "";
  const data = url.match(/^data:[^,]*;base64,(.*)$/is)?.[1];
  if (!data) return RESIZED_IMAGE_BYTES;
  const dimensions = parseImageDimensionsFromBuffer(Buffer.from(data, "base64"));
  if (!dimensions) return RESIZED_IMAGE_BYTES;
  return Math.min(ORIGINAL_IMAGE_MAX_PATCHES, Math.ceil(dimensions.width / 32) * Math.ceil(dimensions.height / 32)) * 4;
}

function contentBytes(content: unknown): number {
  if (typeof content === "string") return textBytes(content);
  if (!Array.isArray(content)) return 0;
  return content.reduce((total, part: unknown) => {
    if (!isPlainObject(part)) return total;
    if (part.type === "input_text" || part.type === "output_text") return total + textBytes(part.text);
    if (part.type === "input_image") return total + imageBytes(part);
    if (part.type === "encrypted_content") return total + Math.ceil(textBytes(part.encrypted_content) * 9 / 16);
    return total;
  }, 0);
}

function itemBytes(item: ResponseInputItem): number {
  const record = item as unknown as Record<string, unknown>;
  if (typeof record.role === "string" || record.type === "message") return contentBytes(record.content);
  switch (record.type) {
    case "function_call":
    case "custom_tool_call":
      return textBytes(record.name) + textBytes(record.namespace ?? "functions") + textBytes(record.arguments ?? record.input);
    case "function_call_output":
    case "custom_tool_call_output":
      return contentBytes(record.output) + textBytes(record.call_id) + textBytes(record.name) + textBytes(record.namespace);
    case "reasoning":
      return Math.max(0, Math.floor(textBytes(record.encrypted_content) * 3 / 4) - 650);
    case "tool_search_call":
      return textBytes(JSON.stringify(record.arguments));
    case "tool_search_output":
    case "additional_tools":
      return textBytes(JSON.stringify(record.tools));
    case "compaction":
      return Math.ceil(textBytes(record.encrypted_content) / 3);
    case "context_compaction":
      return typeof record.encrypted_content === "string"
        ? Math.ceil(textBytes(record.encrypted_content) / 3)
        : 0;
    case "image_generation_call":
      return textBytes(record.revised_prompt)
        + (typeof record.result === "string" && record.result.length > 0 ? RESIZED_IMAGE_BYTES : 0);
    case "local_shell_call":
    case "web_search_call":
      return textBytes(JSON.stringify(record.action));
    default:
      return 0;
  }
}

export function estimateContextItemTokens(item: ResponseInputItem): number {
  return Math.ceil(itemBytes(item) / 4);
}

export function estimateContextItemsTokens(items: ResponseInputItem[]): number {
  return items.reduce((total, item) => total + estimateContextItemTokens(item), 0);
}

export function isModelGeneratedContextItem(item: ResponseInputItem): boolean {
  const record = item as unknown as Record<string, unknown>;
  if (typeof record.role === "string" || record.type === "message") return record.role === "assistant";
  return ["reasoning", "function_call", "custom_tool_call", "tool_search_call", "web_search_call", "image_generation_call", "local_shell_call", "compaction", "context_compaction"].includes(String(record.type));
}

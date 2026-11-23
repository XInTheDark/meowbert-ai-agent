import type { Response, ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { applyPatchFunctionToolDefinition } from "../agent/apply-patch.js";

export type BridgeMcpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } };

export interface BridgeMcpToolResult {
  content: BridgeMcpContentBlock[];
  isError?: boolean;
}

export interface BridgeMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const STRICT_PROXY_HEADER = [
  "[Meowbert Bridge — Strict Proxy Mode]",
  "You are driving a remote Meowbert execution environment. Your local workspace is NOT the task filesystem.",
  "Perform all file reads, edits, shell commands, web searches, skill lookups, and artifact creation exclusively through Meowbert's MCP tools.",
  "Do not use your own built-in file, shell, or web tools.",
  "Text written only in your chat window is invisible to the Meowbert user. Use `meowbert_send_message` for interim updates and finish by calling `meowbert_final_response` (or `meowbert_wait` / `meowbert_stop_task`)."
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDataImageUrl(url: string): { mimeType: string; data: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!match) return null;
  return { mimeType: match[1], data: match[2].replace(/\s+/g, "") };
}

function parseDataPdfUrl(url: string): string | null {
  const match = /^data:application\/pdf;base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  return match ? match[1].replace(/\s+/g, "") : null;
}

function extractTextAndImagesFromContent(content: unknown): { texts: string[]; images: BridgeMcpContentBlock[] } {
  if (typeof content === "string") {
    return { texts: content.trim() ? [content] : [], images: [] };
  }
  if (!Array.isArray(content)) {
    return { texts: [], images: [] };
  }
  const texts: string[] = [];
  const images: BridgeMcpContentBlock[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if ((part.type === "input_text" || part.type === "output_text" || part.type === "text") && typeof part.text === "string") {
      if (part.text.trim()) texts.push(part.text);
    } else if (part.type === "input_image" && typeof part.image_url === "string") {
      const parsed = parseDataImageUrl(part.image_url);
      if (parsed) {
        images.push({ type: "image", mimeType: parsed.mimeType, data: parsed.data });
      }
    } else if (part.type === "input_file" && typeof part.file_data === "string") {
      const blob = parseDataPdfUrl(part.file_data);
      if (blob) {
        const filename = typeof part.filename === "string" && part.filename.trim()
          ? part.filename.trim()
          : "attachment.pdf";
        images.push({
          type: "resource",
          resource: { uri: `file:///attachments/${encodeURIComponent(filename)}`, mimeType: "application/pdf", blob }
        });
      }
    }
  }
  return { texts, images };
}

function formatInputItemForPrompt(item: unknown): { text: string | null; images: BridgeMcpContentBlock[] } {
  if (!isRecord(item)) return { text: null, images: [] };
  if (item.type === "function_call" && typeof item.name === "string") {
    const args = typeof item.arguments === "string" ? item.arguments : "{}";
    return { text: `[Prior tool call: ${item.name}] ${args}`, images: [] };
  }
  if (item.type === "function_call_output" && typeof item.call_id === "string") {
    const output = typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "");
    return { text: `[Prior tool output (${item.call_id})]\n${output}`, images: [] };
  }
  if (typeof item.role === "string") {
    const { texts, images } = extractTextAndImagesFromContent(item.content);
    const body = texts.join("\n").trim();
    const label = item.role.toUpperCase();
    return { text: body ? `### ${label}\n${body}` : null, images };
  }
  return { text: null, images: [] };
}

export function normalizeBridgeTools(rawTools: unknown): BridgeMcpToolDefinition[] {
  if (!Array.isArray(rawTools)) return [];
  const definitions: BridgeMcpToolDefinition[] = [];
  const seen = new Set<string>();
  for (const raw of rawTools) {
    if (!isRecord(raw)) continue;
    const tool = raw.type === "custom" && raw.name === "apply_patch"
      ? (applyPatchFunctionToolDefinition as unknown as Record<string, unknown>)
      : raw;
    if (tool.type !== "function" || typeof tool.name !== "string" || seen.has(tool.name)) continue;
    seen.add(tool.name);
    const params = isRecord(tool.parameters)
      ? tool.parameters
      : { type: "object", properties: {}, additionalProperties: false };
    definitions.push({
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : `Meowbert tool ${tool.name}`,
      inputSchema: params
    });
  }
  return definitions;
}

export function extractInitialPromptBundle(body: Record<string, unknown>): BridgeMcpToolResult {
  const sections: string[] = [STRICT_PROXY_HEADER];
  const images: BridgeMcpContentBlock[] = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    sections.push(`### SYSTEM INSTRUCTIONS\n${body.instructions.trim()}`);
  }
  const inputItems = Array.isArray(body.input) ? body.input : [];
  for (const item of inputItems) {
    const formatted = formatInputItemForPrompt(item);
    if (formatted.text) sections.push(formatted.text);
    if (formatted.images.length > 0) images.push(...formatted.images);
  }
  const tools = normalizeBridgeTools(body.tools);
  if (tools.length > 0) {
    const toolNames = tools.map((tool) => tool.name).join(", ");
    sections.push(`### AVAILABLE MEOWBERT TOOLS\n${toolNames}\nCall \`meowbert_list_tools\` to inspect full JSON schemas for any tool not directly exposed in your MCP tool list, and invoke it via \`meowbert_call_tool\`.`);
  }
  return {
    content: [{ type: "text", text: sections.join("\n\n---\n\n") }, ...images]
  };
}

function readOutputCallId(item: Record<string, unknown>): { callId: string; text: string } | null {
  if (item.type === "function_call_output" && typeof item.call_id === "string") {
    const text = typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "");
    return { callId: item.call_id, text };
  }
  if ((item.type === "custom_tool_call_output" || item.type === "apply_patch_call_output") && typeof item.call_id === "string") {
    const text = typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "");
    return { callId: item.call_id, text };
  }
  return null;
}

export function extractToolResultsFromRequestDelta(
  inputItems: unknown[],
  previousCount: number,
  pendingCallIds: readonly string[]
): Map<string, BridgeMcpToolResult> {
  const pendingSet = new Set(pendingCallIds);
  const results = new Map<string, BridgeMcpContentBlock[]>();
  const delta = inputItems.slice(Math.max(0, previousCount));
  let activeCallId: string | null = null;
  const trailingNotices: BridgeMcpContentBlock[] = [];

  for (const item of delta) {
    if (!isRecord(item)) continue;
    const output = readOutputCallId(item);
    if (output && pendingSet.has(output.callId)) {
      activeCallId = output.callId;
      const blocks = results.get(output.callId) ?? [];
      blocks.push({ type: "text", text: output.text });
      results.set(output.callId, blocks);
      continue;
    }
    if (typeof item.role === "string") {
      const { texts, images } = extractTextAndImagesFromContent(item.content);
      if (images.length > 0 && activeCallId) {
        const blocks = results.get(activeCallId) ?? [];
        blocks.push(...images);
        results.set(activeCallId, blocks);
      }
      if (texts.length > 0) {
        trailingNotices.push({ type: "text", text: `[Meowbert update]\n${texts.join("\n")}` });
      }
    }
  }

  const lastPendingId = pendingCallIds[pendingCallIds.length - 1] ?? null;
  if (lastPendingId && trailingNotices.length > 0) {
    const blocks = results.get(lastPendingId) ?? [];
    blocks.push(...trailingNotices);
    results.set(lastPendingId, blocks);
  }

  const mapped = new Map<string, BridgeMcpToolResult>();
  for (const callId of pendingCallIds) {
    const blocks = results.get(callId);
    mapped.set(callId, {
      content: blocks && blocks.length > 0 ? blocks : [{ type: "text", text: "Tool completed." }]
    });
  }
  return mapped;
}

export function buildSyntheticBridgeResponse(
  responseId: string,
  calls: ReadonlyArray<{ callId: string; name: string; argumentsJson: string }>
): Response {
  const output: ResponseFunctionToolCall[] = calls.map((call, index) => ({
    id: `${responseId}_fc_${index}`,
    type: "function_call",
    call_id: call.callId,
    name: call.name,
    arguments: call.argumentsJson,
    status: "completed"
  }));

  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: "meowbert-bridge",
    output,
    output_text: "",
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: null,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: null,
    truncation: "disabled",
    usage: undefined,
    user: undefined,
    metadata: {}
  } as unknown as Response;
}

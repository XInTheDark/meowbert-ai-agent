import type { TaskMessage } from "../lib/types";
import { parseTaskInlineArtifactOutput } from "./taskInlineArtifacts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isWebSearchResponseItem(value: unknown): value is Record<string, unknown> & { type: "web_search_call" } {
  return isRecord(value) && value.type === "web_search_call";
}

function isApplyPatchResponseItem(value: unknown): value is Record<string, unknown> & { type: "apply_patch_call" } {
  return isRecord(value) && value.type === "apply_patch_call";
}

function isApplyPatchOutputResponseItem(
  value: unknown
): value is Record<string, unknown> & { type: "apply_patch_call_output" } {
  return isRecord(value) && value.type === "apply_patch_call_output";
}

function isCustomToolResponseItem(value: unknown): value is Record<string, unknown> & { type: "custom_tool_call" } {
  return isRecord(value) && value.type === "custom_tool_call";
}

function isCustomToolOutputResponseItem(
  value: unknown
): value is Record<string, unknown> & { type: "custom_tool_call_output" } {
  return isRecord(value) && value.type === "custom_tool_call_output";
}

function isFunctionCallResponseItem(value: unknown): value is Record<string, unknown> & { type: "function_call" } {
  return isRecord(value) && value.type === "function_call";
}

function isFunctionCallOutputResponseItem(
  value: unknown
): value is Record<string, unknown> & { type: "function_call_output" } {
  return isRecord(value) && value.type === "function_call_output";
}

function isToolBearingMessage(message: TaskMessage): boolean {
  if (message.role === "assistant") {
    return true;
  }

  if (message.role === "system") {
    const kind = message.content_json?.kind;
    return kind === "context_checkpoint";
  }

  return false;
}

export function getResponseToolMessages(message: TaskMessage): TaskMessage[] {
  if (!isToolBearingMessage(message)) {
    return [];
  }

  const rawItems = message.content_json.response_items;
  if (!Array.isArray(rawItems)) {
    return [];
  }

  const applyPatchOutputsByCallId = new Map<string, Record<string, unknown>>();
  const functionOutputsByCallId = new Map<string, Record<string, unknown>>();
  const customToolOutputsByCallId = new Map<string, Record<string, unknown>>();
  for (const item of rawItems) {
    if (isApplyPatchOutputResponseItem(item)) {
      const callId = asString(item.call_id);
      if (!callId || applyPatchOutputsByCallId.has(callId)) {
        continue;
      }
      applyPatchOutputsByCallId.set(callId, item);
      continue;
    }

    if (isFunctionCallOutputResponseItem(item)) {
      const callId = asString(item.call_id);
      if (!callId || functionOutputsByCallId.has(callId)) {
        continue;
      }
      functionOutputsByCallId.set(callId, item);
      continue;
    }

    if (!isCustomToolOutputResponseItem(item)) {
      continue;
    }

    const callId = asString(item.call_id);
    if (!callId || customToolOutputsByCallId.has(callId)) {
      continue;
    }
    customToolOutputsByCallId.set(callId, item);
  }

  const messages: TaskMessage[] = [];
  rawItems.forEach((item, index) => {
    if (isWebSearchResponseItem(item)) {
      const callId = asString(item.id);
      messages.push({
        id: `${message.id}:response-tool:${callId ?? index}`,
        role: "tool",
        content_json: {
          tool: "web_search",
          ...(callId ? { callId } : {}),
          response_web_search_call: item
        },
        parent_message_id: message.id,
        edited_from_message_id: null,
        created_at: message.created_at
      });
      return;
    }

    if (isCustomToolResponseItem(item)) {
      const callId = asString(item.call_id) ?? asString(item.id);
      const customOutput = callId ? customToolOutputsByCallId.get(callId) : null;
      const inlineArtifact = customOutput ? parseTaskInlineArtifactOutput(customOutput.output) : null;
      messages.push({
        id: `${message.id}:response-tool:${callId ?? index}`,
        role: "tool",
        content_json: {
          tool: asString(item.name) ?? "custom_tool",
          ...(callId ? { callId } : {}),
          response_custom_tool_call: item,
          ...(customOutput ? { response_custom_tool_output: customOutput } : {}),
          ...(inlineArtifact ? { inline_artifact: inlineArtifact } : {})
        },
        parent_message_id: message.id,
        edited_from_message_id: null,
        created_at: message.created_at
      });
      return;
    }

    if (isFunctionCallResponseItem(item)) {
      const callId = asString(item.call_id) ?? asString(item.id);
      const functionOutput = callId ? functionOutputsByCallId.get(callId) : null;
      const inlineArtifact = functionOutput ? parseTaskInlineArtifactOutput(functionOutput.output) : null;
      if (item.name === "final_response") {
        return;
      }

      messages.push({
        id: `${message.id}:response-tool:${callId ?? index}`,
        role: "tool",
        content_json: {
          tool: asString(item.name) ?? "function_tool",
          ...(callId ? { callId } : {}),
          response_function_call: item,
          ...(functionOutput ? { response_function_output: functionOutput } : {}),
          ...(inlineArtifact ? { inline_artifact: inlineArtifact } : {})
        },
        parent_message_id: message.id,
        edited_from_message_id: null,
        created_at: message.created_at
      });
      return;
    }

    if (!isApplyPatchResponseItem(item)) {
      return;
    }

    const callId = asString(item.call_id) ?? asString(item.id);
    const patchOutput = callId ? applyPatchOutputsByCallId.get(callId) : null;
    messages.push({
      id: `${message.id}:response-tool:${callId ?? index}`,
      role: "tool",
      content_json: {
        tool: "apply_patch",
        ...(callId ? { callId } : {}),
        response_apply_patch_call: item,
        ...(patchOutput ? { response_apply_patch_output: patchOutput } : {})
      },
      parent_message_id: message.id,
      edited_from_message_id: null,
      created_at: message.created_at
    });
  });

  return messages;
}

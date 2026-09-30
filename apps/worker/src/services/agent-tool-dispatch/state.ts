import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { ToolDispatchState } from "./types.js";

const TOOL_OUTPUT_INPUT_FIELDS = new Map<string, readonly string[]>([
  ["run_shell", ["command"]],
  ["computer_local_shell", ["command"]],
  ["memory_search", ["query"]],
  ["enable_skill", ["skill"]],
  ["view_image", ["file_path"]],
  ["view_pdf_file", ["file_path"]],
  ["history_read_item", ["item_id"]],
  ["notes_read_file", ["path"]],
  ["notes_append_to_file", ["path"]],
  ["notes_write_file", ["path"]],
  ["wait", ["seconds"]],
  ["final_response", ["notify", "partial"]]
]);

function formatTokenCount(value: number): string {
  return value.toLocaleString("en-US");
}

function buildContextNotice(state: ToolDispatchState): string {
  const parts: string[] = [];
  const usage = state.contextUsage;
  if (!usage) {
    parts.push("Previous model request context unavailable; the provider returned no input-token usage.");
  } else {
    parts.push(`Model request that produced this tool call: ${usage.usedTokens} / ${usage.maxContextTokens} tokens (${usage.percent}%).`);
  }

  const budget = state.budgetTelemetry;
  if (budget) {
    if (typeof budget.tokenBudget === "number" && budget.tokenBudget > 0) {
      const observed = budget.observedTokenUsage ?? 0;
      const remaining = budget.tokenBudget - observed;
      parts.push(`Token budget: ${formatTokenCount(observed)} / ${formatTokenCount(budget.tokenBudget)} weighted tokens (${formatTokenCount(Math.max(0, remaining))} remaining).`);
    }
    if (typeof budget.timeBudgetMinutes === "number" && budget.timeBudgetMinutes > 0) {
      const elapsedMinutes = ((budget.elapsedSeconds ?? 0) / 60).toFixed(1);
      const remainingMinutes = (Math.max(0, budget.remainingSeconds ?? 0) / 60).toFixed(1);
      parts.push(`Time budget: ${elapsedMinutes} / ${budget.timeBudgetMinutes} minutes (${remainingMinutes}m remaining).`);
    }
    if (budget.isWrapUpRequired) {
      parts.push("Wrap-up required: You are approaching or have reached the budget limit. Do not start new substantive work. Wrap up current work, verify deliverables, and deliver your response now.");
    }
  }

  return parts.join(" ");
}

export function prepareToolOutputForModel(toolName: string, output: unknown): unknown {
  const fields = TOOL_OUTPUT_INPUT_FIELDS.get(toolName);
  if (!fields || typeof output !== "object" || output === null || Array.isArray(output)) {
    return output;
  }

  const preparedOutput = { ...(output as Record<string, unknown>) };
  for (const field of fields) {
    delete preparedOutput[field];
  }
  return preparedOutput;
}

export function serializeToolOutput(output: unknown, state?: ToolDispatchState): string {
  if (!state) {
    return JSON.stringify(output);
  }

  const context = buildContextNotice(state);
  if (typeof output === "object" && output !== null && !Array.isArray(output)) {
    const outputRecord = output as Record<string, unknown>;
    if (!("context" in outputRecord)) {
      return JSON.stringify({ ...outputRecord, context });
    }
  }

  return JSON.stringify({ result: output, context });
}

export function serializeTextToolOutput(output: string, state: ToolDispatchState): string {
  return serializeToolOutput(output, state);
}

export function pushOutput(
  state: ToolDispatchState,
  callId: string,
  output: unknown,
  persistOnly = false
): ResponseInputItem {
  const item: ResponseInputItem = {
    type: "function_call_output",
    call_id: callId,
    output: serializeToolOutput(output, state)
  };
  state.conversationItems.push(item);
  if (!persistOnly) {
    state.runPersistedItems.push(item);
  }
  return item;
}

export function pushToolOutput(
  state: ToolDispatchState,
  callId: string,
  toolName: string,
  output: unknown,
  persistOnly = false
): ResponseInputItem {
  return pushOutput(state, callId, prepareToolOutputForModel(toolName, output), persistOnly);
}

export function pushCustomToolOutput(
  state: ToolDispatchState,
  callId: string,
  output: string,
  persistOnly = false
): ResponseInputItem {
  const item: ResponseInputItem = {
    type: "custom_tool_call_output",
    call_id: callId,
    output: serializeTextToolOutput(output, state)
  } as ResponseInputItem;
  state.conversationItems.push(item);
  if (!persistOnly) {
    state.runPersistedItems.push(item);
  }
  return item;
}

export function pushCustomToolParseError(state: ToolDispatchState, callId: string, error: string): void {
  const item: ResponseInputItem = {
    type: "custom_tool_call_output",
    call_id: callId,
    output: serializeTextToolOutput(`Error: ${error}`, state)
  } as ResponseInputItem;
  state.conversationItems.push(item);
  state.runPersistedItems.push(item);
}

export function pushApplyPatchFailureOutput(state: ToolDispatchState, callId: string, output: string): void {
  const item = {
    type: "apply_patch_call_output",
    call_id: callId,
    status: "failed",
    output: serializeTextToolOutput(output, state)
  } as unknown as ResponseInputItem;
  state.conversationItems.push(item);
  state.runPersistedItems.push(item);
}

export function hasCustomToolOutput(state: ToolDispatchState, callId: string): boolean {
  const hasOutput = (item: ResponseInputItem) => item.type === "custom_tool_call_output" && item.call_id === callId;
  return state.conversationItems.some(hasOutput) || state.runPersistedItems.some(hasOutput);
}

export function hasApplyPatchCallOutput(state: ToolDispatchState, callId: string): boolean {
  const hasOutput = (item: ResponseInputItem) => item.type === "apply_patch_call_output" && item.call_id === callId;
  return state.conversationItems.some(hasOutput) || state.runPersistedItems.some(hasOutput);
}

export function pushParseError(state: ToolDispatchState, callId: string, error: string): void {
  const item: ResponseInputItem = {
    type: "function_call_output",
    call_id: callId,
    output: serializeToolOutput({ error }, state)
  };
  state.conversationItems.push(item);
  state.runPersistedItems.push(item);
}

export function hasFunctionCallOutput(state: ToolDispatchState, callId: string): boolean {
  const hasOutput = (item: ResponseInputItem) => item.type === "function_call_output" && item.call_id === callId;
  return state.conversationItems.some(hasOutput) || state.runPersistedItems.some(hasOutput);
}

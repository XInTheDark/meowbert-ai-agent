import type { ResponseFunctionToolCall, ResponseInputItem } from "openai/resources/responses/responses";
import { config } from "../../../lib/config.js";
import {
  RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS,
  RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { EXEC_TOOL_NAME, execArgumentsSchema } from "../../code-mode/exec-tool.js";
import { dispatchNestedToolCall, type NestedToolDispatcher } from "../../code-mode/nested-dispatch.js";
import { runCodeModeScript } from "../../code-mode/script-runtime.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { pushParseError } from "../state.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { getErrorMessage, normalizeToolEventText } from "../utils.js";

const SUMMARY_MAX_CHARS = 160;

// The summary is one line in the activity view; keep it that way whatever the model sends.
function normalizeSummary(summary: string | null | undefined): string | null {
  const line = normalizeToolEventText(summary?.replace(/\s+/g, " "));
  return line && line.length > SUMMARY_MAX_CHARS ? `${line.slice(0, SUMMARY_MAX_CHARS - 1)}…` : line;
}

function limitText(text: string): string {
  const limit = RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS + RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS;
  if (text.length <= limit) return text;
  return `${text.slice(0, RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS)}\n...[truncated; full length: ${text.length} characters]\n${text.slice(-RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS)}`;
}

function limitResult(result: unknown): unknown {
  const serialized = JSON.stringify(result);
  return serialized !== undefined && serialized.length > RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS + RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS
    ? limitText(serialized)
    : result;
}

// Images and PDFs loaded by nested calls follow exec's own output, as they would a direct call.
function showNestedItems(state: ToolDispatchState, items: ResponseInputItem[]): void {
  state.conversationItems.push(...items);
  state.runPersistedItems.push(...items);
}

function resolveTimeoutMs(timeoutSeconds: number | null, ctx: ToolDispatchContext): number {
  const requestedMs = timeoutSeconds === null ? config.runtime.commandTimeoutMs : timeoutSeconds * 1000;
  return Math.max(1_000, Math.min(requestedMs, ctx.shellToolMaxTimeoutMs));
}

export async function handleExec(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState,
  dispatch: NestedToolDispatcher
): Promise<void> {
  const parsed = parseToolArguments(EXEC_TOOL_NAME, outputItem.arguments, execArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
  }

  const tools = new Map((ctx.codeModeTools ?? []).map((tool) => [tool.name, tool]));
  const summary = normalizeSummary(parsed.value.summary);
  const summaryPayload = summary ? { summary } : {};
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Code",
    inputText: parsed.value.code,
    extraEventPayload: summaryPayload
  });
  let toolCallCount = 0;
  let cancelledByTask = false;
  const shownItems: ResponseInputItem[] = [];
  const script = await runCodeModeScript({
    code: parsed.value.code,
    toolNames: [...tools.keys()],
    timeoutMs: resolveTimeoutMs(parsed.value.timeout_seconds, ctx),
    signal: ctx.cancellationSignal,
    callTool: async (name, args) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      toolCallCount += 1;
      try {
        return await dispatchNestedToolCall({ execCall: outputItem, index: toolCallCount, tool, args, ctx, state, dispatch, shownItems });
      } catch (error) {
        if (getErrorMessage(error) === "TASK_CANCELLED") cancelledByTask = true;
        throw new Error(`Tool ${name} failed: ${getErrorMessage(error)}`);
      }
    }
  });

  if (cancelledByTask || script.cancelled) {
    throw new Error("TASK_CANCELLED");
  }
  await ctx.assertNotCancelled();

  const output = {
    ...(script.logs ? { logs: limitText(script.logs) } : {}),
    ...(script.result !== undefined ? { result: limitResult(script.result) } : {}),
    tool_calls: toolCallCount
  };
  if (script.error) {
    await finishBuiltinToolFailure(ctx, state, execution, script.error, { output, messagePayload: summaryPayload });
  } else {
    await finishBuiltinToolSuccess(ctx, state, execution, output, { messagePayload: summaryPayload });
  }
  showNestedItems(state, shownItems);
}

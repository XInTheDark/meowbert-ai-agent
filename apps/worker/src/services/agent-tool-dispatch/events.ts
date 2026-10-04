import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { parseInlineArtifact, serializeInlineArtifact } from "@meowbert/shared/inline-artifacts";
import { appendMessage, setTaskBranchSelection } from "../agent-db/index.js";
import { emitTaskEvent } from "../runtime/events.js";
import { prepareToolOutputForModel, serializeToolOutput } from "./state.js";
import type { ToolCallResult } from "./tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "./types.js";
import { getErrorMessage, normalizeToolEventText, rethrowIfTaskCancelled } from "./utils.js";

export interface BuiltinToolExecution {
  outputItem: ResponseFunctionToolCall;
  toolName: string;
  callId: string;
  step: number;
  inputLabel: string | null;
  inputText: string | null;
  command: string | null;
  startedAtMs: number;
  interruptible: boolean;
}

export async function appendToolMessage(
  ctx: ToolDispatchContext,
  payload: Record<string, unknown>
): Promise<void> {
  const content = ctx.codeModeParentCallId ? { ...payload, code_mode_parent_call_id: ctx.codeModeParentCallId } : payload;
  const messageId = await appendMessage(ctx.taskId, "tool", content, {
    parentMessageId: ctx.getCurrentLeafMessageId()
  });
  ctx.setCurrentLeafMessageId(messageId);
  if (ctx.selectionUserId) {
    await setTaskBranchSelection(ctx.taskId, ctx.selectionUserId, messageId);
  }
}

export async function startBuiltinToolExecution(
  ctx: ToolDispatchContext,
  state: ToolDispatchState,
  outputItem: ResponseFunctionToolCall,
  options: {
    inputLabel?: string | null;
    inputText?: string | null;
    command?: string | null;
    interruptible?: boolean;
    extraEventPayload?: Record<string, unknown>;
  } = {}
): Promise<BuiltinToolExecution> {
  const step = state.commandStep;
  state.commandStep += 1;

  const inputLabel = normalizeToolEventText(options.inputLabel ?? null);
  const inputText = normalizeToolEventText(options.inputText ?? null);
  const command = normalizeToolEventText(options.command ?? null);
  const interruptible = options.interruptible === true;

  await emitTaskEvent(ctx.taskId, "command_start", {
    step,
    callId: outputItem.call_id,
    tool: outputItem.name,
    ...(command ? { command } : {}),
    ...(inputLabel ? { inputLabel } : {}),
    ...(inputText ? { inputText } : {}),
    ...(interruptible ? { interruptible: true } : {}),
    ...(options.extraEventPayload ?? {})
  });

  return {
    outputItem,
    toolName: outputItem.name,
    callId: outputItem.call_id,
    step,
    inputLabel,
    inputText,
    command,
    startedAtMs: Date.now(),
    interruptible
  };
}

export async function appendBuiltinToolMessage(
  ctx: ToolDispatchContext,
  execution: BuiltinToolExecution,
  output: unknown,
  extraPayload: Record<string, unknown> = {}
): Promise<void> {
  const inlineArtifact = parseInlineArtifact(output);
  const modelOutput = prepareToolOutputForModel(execution.toolName, output);

  await appendToolMessage(ctx, {
    tool: execution.toolName,
    callId: execution.callId,
    step: execution.step,
    ...(execution.command ? { command: execution.command } : {}),
    ...(execution.inputLabel ? { inputLabel: execution.inputLabel } : {}),
    ...(execution.inputText ? { inputText: execution.inputText } : {}),
    ...extraPayload,
    ...(inlineArtifact ? { inline_artifact: serializeInlineArtifact(inlineArtifact) } : {}),
    response_function_call: {
      call_id: execution.outputItem.call_id,
      name: execution.outputItem.name,
      arguments: execution.outputItem.arguments
    },
    response_function_output: {
      call_id: execution.outputItem.call_id,
      output: serializeToolOutput(modelOutput)
    }
  });
}

export async function finishBuiltinToolSuccess(
  ctx: ToolDispatchContext,
  execution: BuiltinToolExecution,
  output: unknown,
  options: {
    eventPayload?: Record<string, unknown>;
    messagePayload?: Record<string, unknown>;
  } = {}
): Promise<ToolCallResult> {
  const durationMs = Date.now() - execution.startedAtMs;
  await appendBuiltinToolMessage(ctx, execution, output, {
    durationMs,
    ...(options.messagePayload ?? {})
  });
  await emitTaskEvent(ctx.taskId, "command_end", {
    step: execution.step,
    callId: execution.callId,
    tool: execution.toolName,
    durationMs,
    ...(options.eventPayload ?? {})
  });
  return { output };
}

export async function finishBuiltinToolFailure(
  ctx: ToolDispatchContext,
  execution: BuiltinToolExecution,
  errorMessage: string,
  options: {
    eventPayload?: Record<string, unknown>;
    messagePayload?: Record<string, unknown>;
    output?: Record<string, unknown>;
  } = {}
): Promise<ToolCallResult> {
  const durationMs = Date.now() - execution.startedAtMs;
  const output = {
    ...(options.output ?? {}),
    error: errorMessage
  };
  await appendBuiltinToolMessage(ctx, execution, output, {
    durationMs,
    error: errorMessage,
    ...(options.messagePayload ?? {})
  });
  await emitTaskEvent(ctx.taskId, "command_end", {
    step: execution.step,
    callId: execution.callId,
    tool: execution.toolName,
    durationMs,
    error: errorMessage,
    ...(options.eventPayload ?? {})
  });
  await emitTaskEvent(ctx.taskId, "error", {
    message: errorMessage,
    step: execution.step,
    callId: execution.callId,
    tool: execution.toolName
  });
  return { output };
}

// A handler threw instead of returning a result. Reports the failure and returns the message the
// caller records as the call's output.
export async function reportUnhandledToolFailure(
  toolName: string,
  callId: string,
  ctx: ToolDispatchContext,
  error: unknown
): Promise<string> {
  rethrowIfTaskCancelled(error);
  const errorMessage = `Tool ${toolName} failed: ${getErrorMessage(error)}`;
  try {
    await emitTaskEvent(ctx.taskId, "error", {
      message: errorMessage,
      callId,
      tool: toolName
    });
  } catch {
    // Best-effort error logging only; keep the run alive if event emission fails too.
  }
  return errorMessage;
}

import { APPLY_PATCH_TOOL_NAME } from "../../agent-tools/index.js";
import {
  applyPatchOperationToWorkspace,
  createApplyPatchCallOutput,
  createApplyPatchFunctionToolCallOutput,
  createApplyPatchCustomToolCallOutput,
  formatApplyPatchOperationSummary,
  applyPatchFunctionToolArgumentsSchema,
  parseApplyPatchDocument,
  type ApplyPatchCall,
  type ApplyPatchCustomToolCall,
  type ApplyPatchFunctionToolCall,
  type ApplyPatchOperation
} from "../../agent/apply-patch.js";
import { resolveApplyPatchWritableRoots } from "../../agent/task-write-scope.js";
import { emitTaskEvent } from "../../runtime/events.js";
import { appendToolMessage } from "../events.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { serializeTextToolOutput } from "../state.js";
import { rethrowIfTaskCancelled } from "../utils.js";

interface ApplyPatchInvocation {
  callId: string;
  inputLabel: string;
  inputText: string;
  operations: ApplyPatchOperation[];
  rawItem: ApplyPatchCall | ApplyPatchCustomToolCall | ApplyPatchFunctionToolCall;
}

function isNativeApplyPatchCall(
  value: ApplyPatchCall | ApplyPatchCustomToolCall | ApplyPatchFunctionToolCall
): value is ApplyPatchCall {
  return value.type === "apply_patch_call";
}

function isFunctionApplyPatchCall(
  value: ApplyPatchCall | ApplyPatchCustomToolCall | ApplyPatchFunctionToolCall
): value is ApplyPatchFunctionToolCall {
  return value.type === "function_call";
}

function parseFunctionPatchArguments(outputItem: ApplyPatchFunctionToolCall): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputItem.arguments);
  } catch {
    throw new Error("apply_patch arguments are not valid JSON");
  }

  const validated = applyPatchFunctionToolArgumentsSchema.safeParse(parsed);
  if (!validated.success) {
    const details = validated.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`apply_patch arguments are invalid: ${details}`);
  }

  return validated.data.patch;
}

function buildApplyPatchInvocation(
  outputItem: ApplyPatchCall | ApplyPatchCustomToolCall | ApplyPatchFunctionToolCall
): ApplyPatchInvocation {
  if (isNativeApplyPatchCall(outputItem)) {
    return {
      callId: outputItem.call_id,
      inputLabel: "Operation",
      inputText: formatApplyPatchOperationSummary(outputItem.operation),
      operations: [outputItem.operation],
      rawItem: outputItem
    };
  }

  const patch = isFunctionApplyPatchCall(outputItem)
    ? parseFunctionPatchArguments(outputItem)
    : outputItem.input;
  const operations = parseApplyPatchDocument(patch);
  return {
    callId: outputItem.call_id,
    inputLabel: "Patch",
    inputText: operations.map((operation) => formatApplyPatchOperationSummary(operation)).join("\n"),
    operations,
    rawItem: outputItem
  };
}

function pushApplyPatchOutput(
  outputItem: ApplyPatchCall | ApplyPatchCustomToolCall | ApplyPatchFunctionToolCall,
  state: ToolDispatchState,
  output: string,
  status: "completed" | "failed"
): string {
  const contextAwareOutput = serializeTextToolOutput(output, state);
  const result = isNativeApplyPatchCall(outputItem)
    ? createApplyPatchCallOutput(outputItem.call_id, status, contextAwareOutput)
    : isFunctionApplyPatchCall(outputItem)
      ? createApplyPatchFunctionToolCallOutput(outputItem.call_id, contextAwareOutput)
      : createApplyPatchCustomToolCallOutput(outputItem.call_id, contextAwareOutput);
  state.conversationItems.push(result);
  state.runPersistedItems.push(result);
  return contextAwareOutput;
}

function buildApplyPatchMessageResponseItems(
  outputItem: ApplyPatchCall | ApplyPatchCustomToolCall | ApplyPatchFunctionToolCall,
  callId: string,
  status: "completed" | "failed",
  contextAwareOutput: string
): Record<string, unknown> {
  if (isNativeApplyPatchCall(outputItem)) {
    return {
      response_apply_patch_call: outputItem,
      response_apply_patch_output: {
        call_id: callId,
        status,
        output: contextAwareOutput
      }
    };
  }

  if (isFunctionApplyPatchCall(outputItem)) {
    return {
      response_function_call: {
        call_id: outputItem.call_id,
        name: outputItem.name,
        arguments: outputItem.arguments
      },
      response_function_output: {
        call_id: outputItem.call_id,
        output: contextAwareOutput
      }
    };
  }

  return {
    response_custom_tool_call: {
      call_id: outputItem.call_id,
      name: outputItem.name,
      input: outputItem.input
    },
    response_custom_tool_output: {
      call_id: outputItem.call_id,
      output: contextAwareOutput
    }
  };
}

export async function handleApplyPatch(
  outputItem: ApplyPatchCall | ApplyPatchCustomToolCall | ApplyPatchFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  await ctx.assertNotCancelled();
  const invocation = buildApplyPatchInvocation(outputItem);
  const step = state.commandStep;
  state.commandStep += 1;
  const startedAtMs = Date.now();

  await emitTaskEvent(ctx.taskId, "command_start", {
    step,
    callId: invocation.callId,
    tool: APPLY_PATCH_TOOL_NAME,
    inputLabel: invocation.inputLabel,
    inputText: invocation.inputText
  });

  const outputs: string[] = [];
  const absolutePaths: string[] = [];
  const writableRoots = resolveApplyPatchWritableRoots({
    taskDir: ctx.taskDir,
    envRoot: ctx.envRoot,
    workspaceRoot: ctx.workspaceRoot,
    isThreadTask: ctx.isThreadTask,
    workflowType: ctx.workflowContext?.workflowType ?? null,
    workflowTaskId: ctx.workflowContext?.workflowTaskId ?? null
  });

  try {
    for (const operation of invocation.operations) {
      await ctx.assertNotCancelled();
      const result = await applyPatchOperationToWorkspace({
        operation,
        baseDir: ctx.taskDir,
        writableRoots
      });
      outputs.push(result.output);
      absolutePaths.push(result.absolutePath);
    }

    const outputText = outputs.join("\n");
    const contextAwareOutput = pushApplyPatchOutput(outputItem, state, outputText, "completed");
    const durationMs = Date.now() - startedAtMs;

    await appendToolMessage(ctx, {
      tool: APPLY_PATCH_TOOL_NAME,
      callId: invocation.callId,
      step,
      inputLabel: invocation.inputLabel,
      inputText: invocation.inputText,
      durationMs,
      operationCount: invocation.operations.length,
      paths: invocation.operations.map((operation) => operation.path),
      absolutePaths,
      stdout: outputText,
      ...buildApplyPatchMessageResponseItems(outputItem, invocation.callId, "completed", contextAwareOutput)
    });

    await emitTaskEvent(ctx.taskId, "command_end", {
      step,
      callId: invocation.callId,
      tool: APPLY_PATCH_TOOL_NAME,
      durationMs,
      operationCount: invocation.operations.length,
      paths: invocation.operations.map((operation) => operation.path),
      absolutePaths
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    const failureText = outputs.length > 0
      ? `${outputs.join("\n")}\nError: ${message}`
      : `Error: ${message}`;
    const contextAwareFailure = pushApplyPatchOutput(outputItem, state, failureText, "failed");
    const durationMs = Date.now() - startedAtMs;

    await appendToolMessage(ctx, {
      tool: APPLY_PATCH_TOOL_NAME,
      callId: invocation.callId,
      step,
      inputLabel: invocation.inputLabel,
      inputText: invocation.inputText,
      durationMs,
      operationCount: invocation.operations.length,
      paths: invocation.operations.map((operation) => operation.path),
      absolutePaths,
      stdout: outputs.join("\n"),
      error: message,
      ...buildApplyPatchMessageResponseItems(outputItem, invocation.callId, "failed", contextAwareFailure)
    });

    await emitTaskEvent(ctx.taskId, "command_end", {
      step,
      callId: invocation.callId,
      tool: APPLY_PATCH_TOOL_NAME,
      durationMs,
      operationCount: invocation.operations.length,
      paths: invocation.operations.map((operation) => operation.path),
      absolutePaths,
      error: message
    });
    await emitTaskEvent(ctx.taskId, "error", {
      message,
      step,
      callId: invocation.callId,
      tool: APPLY_PATCH_TOOL_NAME
    });
  }
}

import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  SHELL_SESSION_TOOL_NAME,
  shellSessionArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import type { PersistentShellRequest } from "../../agent/ports/platform-tools.js";
import {
  finishBuiltinToolFailure,
  finishBuiltinToolSuccess,
  startBuiltinToolExecution
} from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { getErrorMessage } from "../utils.js";

function assertPersistentShellsAvailable(ctx: ToolDispatchContext): void {
  if (!ctx.persistentRuntimeEnabled) {
    throw new Error("Persistent project shell sessions are disabled for this project.");
  }
  if (!ctx.actorUserId) {
    throw new Error("Persistent project shell sessions require an authenticated user.");
  }
}

type ShellSessionArguments = Extract<ReturnType<typeof parseShellSessionArguments>, { ok: true }>["value"];

function parseShellSessionArguments(outputItem: ResponseFunctionToolCall) {
  return parseToolArguments(SHELL_SESSION_TOOL_NAME, outputItem.arguments, shellSessionArgumentsSchema);
}

function buildShellSessionRequest(ctx: ToolDispatchContext, args: ShellSessionArguments): PersistentShellRequest {
  switch (args.action) {
    case "list":
      return { action: "list" };
    case "start":
      return {
        action: "start",
        command: args.command,
        mode: args.mode,
        lifetimeSeconds: args.lifetime_seconds ?? args.lifetime ?? null,
        envOverrides: ctx.shellEnvOverrides
      };
    case "stop":
      return { action: "stop", sessionId: args.session_id! };
    case "input":
    case "interrupt":
    case "eof":
    case "resize":
      return {
        action: "control",
        sessionId: args.session_id!,
        control: args.action,
        data: args.data,
        cols: args.cols,
        rows: args.rows
      };
    default:
      return {
        action: "status",
        sessionId: args.session_id!,
        tailLines: args.tail_lines,
        saveOutputPath: args.save_output_path
      };
  }
}

export async function handleShellSession(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const parsed = parseShellSessionArguments(outputItem);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Persistent shell session",
    inputText: parsed.value.action
  });
  try {
    assertPersistentShellsAvailable(ctx);
    const output = await ctx.control.platform.persistentShell(buildShellSessionRequest(ctx, parsed.value));
    return await finishBuiltinToolSuccess(ctx, execution, output);
  } catch (error) {
    return finishBuiltinToolFailure(ctx, execution, getErrorMessage(error));
  }
}

export async function handlePersistentRunShell(input: {
  outputItem: ResponseFunctionToolCall;
  ctx: ToolDispatchContext;
  state: ToolDispatchState;
  command: string;
  sessionId: string;
  force: boolean;
}): Promise<ToolCallResult> {
  const execution = await startBuiltinToolExecution(input.ctx, input.state, input.outputItem, {
    inputLabel: "Persistent shell command",
    inputText: input.command,
    command: input.command
  });
  try {
    assertPersistentShellsAvailable(input.ctx);
    const output = await input.ctx.control.platform.persistentShell({
      action: "run",
      sessionId: input.sessionId,
      command: input.command,
      force: input.force,
      envOverrides: input.ctx.shellEnvOverrides
    });
    return await finishBuiltinToolSuccess(input.ctx, execution, output);
  } catch (error) {
    return finishBuiltinToolFailure(input.ctx, execution, getErrorMessage(error));
  }
}

import { z } from "zod";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

export async function handleHostShell(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState) {
  await ctx.assertNotCancelled();
  if (!ctx.control.platform.hostShell) return toolErrorResult("Host shell is disabled on this device.");
  const args = parseToolArguments(call.name, call.arguments, z.object({
    command: z.string().min(1), timeout_seconds: z.number().positive().max(86_400).nullable()
  }).strict());
  if (!args.ok) return toolErrorResult(args.error);
  const execution = await startBuiltinToolExecution(ctx, state, call, { command: args.value.command });
  try {
    const output = await ctx.control.platform.hostShell({
      command: args.value.command, timeoutMs: Math.min((args.value.timeout_seconds ?? 30) * 1000, ctx.shellToolMaxTimeoutMs)
    });
    return await finishBuiltinToolSuccess(ctx, execution, output, { messagePayload: output });
  } catch (error) {
    return finishBuiltinToolFailure(ctx, execution, error instanceof Error ? error.message : String(error));
  }
}

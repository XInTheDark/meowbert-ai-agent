import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { spawnSubagentSchema, subagentMessageSchema, subagentTargetSchema, subagentWaitSchema } from "@meowbert/run-executor/agent-tools/subagents";
import { spawnSubagent } from "../../subagents/spawn.js";
import { chooseSubagentRuntime } from "../../subagents/runtime.js";
import { hasSubagentMail, listSubagents, sendSubagentMessage } from "../../subagents/mail.js";
import { interruptSubagent } from "../../subagents/interrupt.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "@meowbert/run-executor/agent-tool-dispatch/events";
import type { ToolCallResult } from "@meowbert/run-executor/agent-tool-dispatch/tool-call-result";
import type { ToolDispatchContext, ToolDispatchState } from "@meowbert/run-executor/agent-tool-dispatch/types";
import { rethrowIfTaskCancelled } from "@meowbert/run-executor/agent-tool-dispatch/utils";

async function runSubagentTool(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState) {
  const args: unknown = JSON.parse(call.arguments);
  const key = `${ctx.runId}:${call.call_id}`;
  switch (call.name) {
    case "spawn_subagent": {
      const input = spawnSubagentSchema.parse(args);
      if (!ctx.subagentRuntime) throw new Error("Subagent model configuration is unavailable.");
      const tier = input.model ?? "default";
      const runtime = chooseSubagentRuntime({ parent: ctx.subagentRuntime, tier,
        fastAgentId: ctx.subagentFastAgent ?? null, presets: ctx.subagentPresets ?? [] });
      const child = await spawnSubagent({ ...ctx, runtime, model: tier, message: input.message,
        title: input.title ?? null, tools: ctx.runToolOptions, spawnKey: key });
      return { subagent_id: child.id, status: child.status, task_root_path: child.task_root_path, model: tier };
    }
    case "send_subagent_message":
    case "followup_subagent": {
      const input = subagentMessageSchema.parse(args);
      await sendSubagentMessage({ ...ctx, ...input, followup: call.name === "followup_subagent", deliveryKey: key });
      return { sent: true };
    }
    case "wait_subagent": {
      const input = subagentWaitSchema.parse(args);
      if (await hasSubagentMail(ctx.taskId)) return { ready: true };
      state.subagentWaitDeadline = new Date(Date.now() + (input.timeout_seconds ?? 60) * 1000).toISOString();
      return { waiting: true, deadline: state.subagentWaitDeadline };
    }
    case "list_subagents": return { subagents: await listSubagents(ctx) };
    case "interrupt_subagent": {
      const input = subagentTargetSchema.parse(args);
      return { previous_status: await interruptSubagent(ctx, input.target) };
    }
    default: throw new Error("Unknown subagent tool.");
  }
}

export async function handleSubagentTool(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  const execution = await startBuiltinToolExecution(ctx, state, call, { inputLabel: "Subagent" });
  try {
    if (ctx.readOnly || !ctx.runToolOptions.subtasks) throw new Error("Subagents are disabled for this task.");
    await ctx.assertNotCancelled();
    const result = await runSubagentTool(call, ctx, state);
    return await finishBuiltinToolSuccess(ctx, execution, result);
  } catch (error) {
    state.subagentWaitDeadline = undefined;
    rethrowIfTaskCancelled(error);
    return finishBuiltinToolFailure(ctx, execution, error instanceof Error ? error.message : String(error));
  }
}

import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { executeShellCommand } from "../../runtime/shell.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext } from "../types.js";

const OUTPUT_TAIL_CHARS = 4000;

export type StopCheckOutcome =
  | { kind: "none" }
  | { kind: "passed" }
  | { kind: "rejected"; result: ToolCallResult }
  // The check kept failing; the answer goes through with this note.
  | { kind: "bypassed"; note: string };

function isPartialResponse(outputItem: ResponseFunctionToolCall): boolean {
  try {
    return (JSON.parse(outputItem.arguments) as { partial?: unknown }).partial === true;
  } catch {
    return false;
  }
}

function tail(text: string): string {
  return text.length > OUTPUT_TAIL_CHARS ? `...${text.slice(-OUTPUT_TAIL_CHARS)}` : text;
}

// Runs the task's stop check before final_response is accepted. A failing check rejects the call
// with its output, so the agent keeps working; after the attempt limit the answer goes through.
export async function runStopCheck(outputItem: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<StopCheckOutcome> {
  const harness = ctx.harness;
  const stopCheck = harness?.settings.stopCheck?.value;
  if (!harness || !stopCheck || ctx.readOnly || isPartialResponse(outputItem)) return { kind: "none" };
  if (harness.stopCheckFailures >= harness.maxStopCheckAttempts) {
    return { kind: "bypassed", note: `Note: the stop check \`${stopCheck.command}\` is still failing after ${harness.stopCheckFailures} attempts.` };
  }

  const result = await executeShellCommand({
    sandbox: ctx.sandbox,
    shell: ctx.settings.shell,
    command: stopCheck.command,
    taskDir: ctx.taskDir,
    envRoot: ctx.envRoot,
    envOverrides: ctx.shellEnvOverrides,
    timeoutMs: stopCheck.timeoutSeconds * 1000,
    maxOutputKb: ctx.settings.maxCommandOutputKb,
    abortSignal: ctx.cancellationSignal
  });
  await ctx.assertNotCancelled();
  if (result.exitCode === 0 && !result.timedOut) {
    harness.stopCheckFailures = 0;
    await ctx.control.emitEvent("log", { message: `Stop check passed: ${stopCheck.command}` });
    return { kind: "passed" };
  }

  harness.stopCheckFailures += 1;
  const reason = result.timedOut ? `timed out after ${stopCheck.timeoutSeconds}s` : `exited with code ${result.exitCode}`;
  await ctx.control.emitEvent("log", { message: `Stop check failed (${reason}): ${stopCheck.command}` });
  return {
    kind: "rejected",
    result: toolErrorResult([
      `The task can't finish yet: its stop check \`${stopCheck.command}\` ${reason}.`,
      "Fix the problem and call final_response again.",
      "",
      tail(`${result.stdout}\n${result.stderr}`.trim())
    ].join("\n"))
  };
}

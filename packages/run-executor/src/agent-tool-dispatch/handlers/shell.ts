import path from "node:path";
import { validateOrganizationFinalResponse } from "./conversation-organization.js";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  SHELL_OUTPUT_DIRNAME,
  isOutputOverWindow,
  saveShellOutputFile,
  stripAnsi,
  windowShellOutput
} from "@meowbert/shared";
import {
  FINAL_RESPONSE_TOOL_NAME,
  REFRESH_GH_TOKEN_TOOL_NAME,
  RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS,
  RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS,
  RUN_SHELL_TOOL_NAME,
  createRunShellArgumentsSchema,
  finalResponseArgumentsSchema,
  refreshGhTokenArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { executeShellCommand, type ShellExecutionResult } from "../../runtime/shell.js";
import { handlePersistentRunShell } from "./persistent-shell.js";
import {
  finishBuiltinToolFailure,
  finishBuiltinToolSuccess,
  startBuiltinToolExecution
} from "../events.js";
import { startCommandInterruptMonitor } from "../interrupts.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import type { ExecutorSettings } from "../../agent/ports/executor-settings.js";
import { getErrorMessage, rethrowIfTaskCancelled } from "../utils.js";

type RunShellArguments = {
  command?: string | null;
  timeout_seconds?: number | null;
  session_id?: string | null;
  force?: boolean | null;
  background?: boolean | null;
  background_id?: string | null;
  wait_seconds?: number | null;
  limit_start?: number | null;
  limit_end?: number | null;
  stop?: boolean | null;
};

interface ShellOutputLimits {
  limitStart: number;
  limitEnd: number;
}

type BuiltinExecution = Awaited<ReturnType<typeof startBuiltinToolExecution>>;

interface ForegroundShellCommandResult {
  shellResult: ShellExecutionResult & { cwd: string; stateReset: boolean };
  interruptedByRequest: boolean;
  interruptWasConsumed: boolean;
}

function resolveCommandTimeoutMs(args: RunShellArguments, ctx: ToolDispatchContext): number {
  const requestedTimeoutMs =
    typeof args.timeout_seconds === "number"
      ? args.timeout_seconds * 1000
      : ctx.settings.commandTimeoutMs;
  return Math.max(1_000, Math.min(requestedTimeoutMs, ctx.shellToolMaxTimeoutMs));
}

function resolveOutputLimits(args: RunShellArguments, settings: ExecutorSettings): ShellOutputLimits {
  const maxOutputChars = settings.maxCommandOutputKb * 1024;
  const requestedStart = typeof args.limit_start === "number"
    ? Math.max(0, args.limit_start)
    : RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS;
  const requestedEnd = typeof args.limit_end === "number"
    ? Math.max(0, args.limit_end)
    : RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS;

  return {
    limitStart: Math.min(requestedStart, maxOutputChars),
    limitEnd: Math.min(requestedEnd, maxOutputChars)
  };
}

// Output past the window is saved in the task's scratch directory, so the agent can read the part
// it did not see instead of losing it.
async function presentShellOutput(input: {
  ctx: ToolDispatchContext;
  execution: BuiltinExecution;
  stream: "stdout" | "stderr";
  output: string;
  capturedLength: number | undefined;
  limits: ShellOutputLimits;
}): Promise<string> {
  const cleanOutput = stripAnsi(input.output);
  const fullLength = input.capturedLength !== undefined && input.capturedLength !== input.output.length
    ? input.capturedLength
    : cleanOutput.length;
  const window = { head: input.limits.limitStart, tail: input.limits.limitEnd };
  if (!isOutputOverWindow(fullLength, window)) {
    return cleanOutput;
  }

  const name = `${Date.now().toString(36)}-step${input.execution.step}-${input.stream}.txt`;
  const savedTo = await saveShellOutputFile({
    dir: path.join(input.ctx.taskScratchDir, SHELL_OUTPUT_DIRNAME),
    name,
    text: cleanOutput
  }).then(() => `$TASK_SCRATCH_DIR/${SHELL_OUTPUT_DIRNAME}/${name}`, () => null);
  return windowShellOutput(cleanOutput, fullLength, window, savedTo);
}

async function runForegroundShellCommand(input: {
  ctx: ToolDispatchContext;
  execution: BuiltinExecution;
  command: string;
  timeoutMs: number;
}): Promise<ForegroundShellCommandResult> {
  const commandAbortController = new AbortController();
  let interruptedByRequest = false;
  const interruptMonitor = startCommandInterruptMonitor({
    control: input.ctx.control,
    step: input.execution.step,
    onInterrupt: () => {
      interruptedByRequest = true;
      if (!commandAbortController.signal.aborted) {
        commandAbortController.abort(new Error("COMMAND_INTERRUPTED"));
      }
    }
  });

  const abortFromTaskCancellation = (): void => {
    if (!commandAbortController.signal.aborted) {
      commandAbortController.abort(new Error("TASK_CANCELLED"));
    }
  };
  if (input.ctx.cancellationSignal) {
    if (input.ctx.cancellationSignal.aborted) {
      abortFromTaskCancellation();
    } else {
      input.ctx.cancellationSignal.addEventListener("abort", abortFromTaskCancellation, { once: true });
    }
  }

  try {
    const result = await executeShellCommand({
      sandbox: input.ctx.sandbox,
      shell: input.ctx.settings.shell,
      command: input.command,
      taskDir: input.ctx.taskDir,
      envRoot: input.ctx.envRoot,
      envOverrides: input.ctx.shellEnvOverrides,
      timeoutMs: input.timeoutMs,
      maxOutputKb: input.ctx.settings.maxCommandOutputKb,
      abortSignal: commandAbortController.signal
    });
    return {
      shellResult: { ...result, cwd: input.ctx.taskDir, stateReset: true },
      interruptedByRequest,
      interruptWasConsumed: interruptMonitor.wasInterrupted()
    };
  } finally {
    interruptMonitor.stop();
    if (input.ctx.cancellationSignal) {
      input.ctx.cancellationSignal.removeEventListener("abort", abortFromTaskCancellation);
    }
  }
}

async function finishForegroundShellFailure(input: {
  ctx: ToolDispatchContext;
  execution: BuiltinExecution;
  command: string;
  error: unknown;
}): Promise<ToolCallResult> {
  rethrowIfTaskCancelled(input.error);
  const message = `Failed to run shell command: ${getErrorMessage(input.error)}`;
  const durationMs = Date.now() - input.execution.startedAtMs;
  return finishBuiltinToolFailure(input.ctx, input.execution, message, {
    output: {
      command: input.command,
      step: input.execution.step,
      cwd: input.ctx.taskDir,
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      stateReset: true,
      durationMs
    },
    eventPayload: {
      command: input.command,
      cwd: input.ctx.taskDir,
      exitCode: null,
      timedOut: false,
      stateReset: true
    },
    messagePayload: {
      cwd: input.ctx.taskDir,
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      stateReset: true
    }
  });
}

async function finishForegroundShellResult(input: {
  ctx: ToolDispatchContext;
  execution: BuiltinExecution;
  command: string;
  shellResult: ShellExecutionResult & { cwd: string; stateReset: boolean };
  interruptedByRequest: boolean;
  outputLimits: ShellOutputLimits;
}): Promise<ToolCallResult> {
  const durationMs = Date.now() - input.execution.startedAtMs;
  const [stdout, stderr] = await Promise.all([
    presentShellOutput({
      ctx: input.ctx,
      execution: input.execution,
      stream: "stdout",
      output: input.shellResult.stdout,
      capturedLength: input.shellResult.stdoutLength,
      limits: input.outputLimits
    }),
    presentShellOutput({
      ctx: input.ctx,
      execution: input.execution,
      stream: "stderr",
      output: input.shellResult.stderr,
      capturedLength: input.shellResult.stderrLength,
      limits: input.outputLimits
    })
  ]);

  if (input.shellResult.aborted && input.interruptedByRequest) {
    const interruptionMessage = "Command interrupted by user.";
    const toolResult = {
      command: input.shellResult.command,
      step: input.execution.step,
      cwd: input.shellResult.cwd,
      stdout,
      stderr: stderr.trim().length > 0 ? stderr : interruptionMessage,
      error: interruptionMessage,
      interrupted: true,
      exitCode: input.shellResult.exitCode,
      timedOut: false,
      stateReset: input.shellResult.stateReset,
      durationMs
    };

    return finishBuiltinToolSuccess(input.ctx, input.execution, toolResult, {
      eventPayload: {
        command: input.command,
        cwd: input.shellResult.cwd,
        interrupted: true,
        exitCode: input.shellResult.exitCode,
        timedOut: false,
        stateReset: input.shellResult.stateReset
      },
      messagePayload: {
        cwd: input.shellResult.cwd,
        stdout: toolResult.stdout,
        stderr: toolResult.stderr,
        error: interruptionMessage,
        interrupted: true,
        exitCode: input.shellResult.exitCode,
        timedOut: false,
        stateReset: input.shellResult.stateReset
      }
    });
  }

  const toolResult = {
    command: input.shellResult.command,
    step: input.execution.step,
    cwd: input.shellResult.cwd,
    stdout,
    stderr,
    exitCode: input.shellResult.exitCode,
    timedOut: input.shellResult.timedOut,
    stateReset: input.shellResult.stateReset,
    durationMs,
    ...(input.shellResult.sandboxCrash ? { sandbox_crash: input.shellResult.sandboxCrash } : {})
  };

  return finishBuiltinToolSuccess(input.ctx, input.execution, toolResult, {
    eventPayload: {
      command: input.command,
      cwd: input.shellResult.cwd,
      exitCode: input.shellResult.exitCode,
      timedOut: input.shellResult.timedOut,
      stateReset: input.shellResult.stateReset
    },
    messagePayload: {
      cwd: input.shellResult.cwd,
      stdout,
      stderr,
      exitCode: input.shellResult.exitCode,
      timedOut: input.shellResult.timedOut,
      stateReset: input.shellResult.stateReset
    }
  });
}

async function handleForegroundShell(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState,
  args: RunShellArguments
): Promise<ToolCallResult> {
  if (typeof args.command !== "string") {
    return toolErrorResult("command is required for foreground run_shell calls.");
  }

  const timeoutMs = resolveCommandTimeoutMs(args, ctx);
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Command",
    inputText: args.command,
    command: args.command,
    interruptible: true
  });

  let result: ForegroundShellCommandResult;
  try {
    result = await runForegroundShellCommand({
      ctx,
      execution,
      command: args.command,
      timeoutMs
    });
  } catch (error) {
    return finishForegroundShellFailure({
      ctx,
      execution,
      command: args.command,
      error
    });
  }

  if (result.shellResult.aborted && !result.interruptWasConsumed) {
    throw new Error("TASK_CANCELLED");
  }
  await ctx.assertNotCancelled();

  return finishForegroundShellResult({
    ctx,
    execution,
    command: args.command,
    shellResult: result.shellResult,
    interruptedByRequest: result.interruptedByRequest,
    outputLimits: resolveOutputLimits(args, ctx.settings)
  });
}

export async function handleRunShell(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const shellTimeoutMaxSeconds = Math.max(1, Math.floor(ctx.shellToolMaxTimeoutMs / 1000));
  const parsed = parseToolArguments(
    RUN_SHELL_TOOL_NAME,
    outputItem.arguments,
    createRunShellArgumentsSchema(shellTimeoutMaxSeconds)
  );
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  await ctx.assertNotCancelled();

  if (parsed.value.background === true || parsed.value.background_id) {
    return toolErrorResult("run_shell background mode was replaced by persistent shell_session. Start a session, then use run_shell with session_id.");
  }

  if (parsed.value.session_id) {
    if (typeof parsed.value.command !== "string") {
      return toolErrorResult("command is required when session_id is provided.");
    }
    return handlePersistentRunShell({
      outputItem,
      ctx,
      state,
      command: parsed.value.command,
      sessionId: parsed.value.session_id,
      force: parsed.value.force === true
    });
  }

  return handleForegroundShell(outputItem, ctx, state, parsed.value);
}


export function handleFinalResponse(
  outputItem: ResponseFunctionToolCall,
  state: ToolDispatchState
): ToolCallResult {
  const parsed = parseToolArguments(FINAL_RESPONSE_TOOL_NAME, outputItem.arguments, finalResponseArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  validateOrganizationFinalResponse(parsed.value, state);
  const notify = parsed.value.notify ?? true;
  const partial = parsed.value.partial ?? false;
  return {
    output: { acknowledged: true, notify, partial },
    finalResponse: {
      response: parsed.value.response.trim(),
      ...(state.organization && parsed.value.summary ? { summary: parsed.value.summary.trim() } : {}),
      notify,
      partial
    }
  };
}

export async function handleRefreshGitHubToken(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const parsed = parseToolArguments(
    REFRESH_GH_TOKEN_TOOL_NAME,
    outputItem.arguments,
    refreshGhTokenArgumentsSchema
  );
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Action",
    inputText: "Refresh GitHub token"
  });

  if (!ctx.refreshGitHubToken) {
    return finishBuiltinToolFailure(
      ctx,
      execution,
      "GitHub token refresh is unavailable for this run."
    );
  }

  const result = await ctx.refreshGitHubToken();
  if (!result.ok) {
    return finishBuiltinToolFailure(
      ctx,
      execution,
      result.error ?? "Failed to refresh GitHub token.",
      { output: result }
    );
  }

  return finishBuiltinToolSuccess(ctx, execution, result, {
    eventPayload: result.login ? { login: result.login } : {}
  });
}

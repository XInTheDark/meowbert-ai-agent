import { validateOrganizationFinalResponse } from "./conversation-organization.js";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { stripAnsi } from "@meowbert/shared";
import { config } from "../../../lib/config.js";
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
import { pushParseError, pushToolOutput } from "../state.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
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
      : config.runtime.commandTimeoutMs;
  return Math.max(1_000, Math.min(requestedTimeoutMs, ctx.shellToolMaxTimeoutMs));
}

function resolveOutputLimits(args: RunShellArguments): ShellOutputLimits {
  const maxOutputChars = config.runtime.maxCommandOutputKb * 1024;
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

function formatShellOutput(
  output: string,
  fullLength: number | undefined,
  limits: ShellOutputLimits
): string {
  const cleanOutput = stripAnsi(output);
  const resolvedFullLength = fullLength !== undefined && fullLength !== output.length
    ? fullLength
    : cleanOutput.length;
  const totalLimit = limits.limitStart + limits.limitEnd;
  if (resolvedFullLength <= totalLimit) {
    return cleanOutput;
  }

  const truncationMarker = `...[truncated; full output length: ${resolvedFullLength} characters]`;
  const head = limits.limitStart > 0 ? cleanOutput.slice(0, limits.limitStart) : "";
  const tailStartIndex = Math.max(head.length, cleanOutput.length - limits.limitEnd);
  const tail = limits.limitEnd > 0 && tailStartIndex < cleanOutput.length ? cleanOutput.slice(tailStartIndex) : "";

  if (head.length > 0 && tail.length > 0) {
    return `${head}\n${truncationMarker}\n${tail}`;
  }
  if (head.length > 0) {
    return `${head}\n${truncationMarker}`;
  }
  if (tail.length > 0) {
    return `${truncationMarker}\n${tail}`;
  }
  return truncationMarker;
}

async function runForegroundShellCommand(input: {
  ctx: ToolDispatchContext;
  state: ToolDispatchState;
  execution: BuiltinExecution;
  command: string;
  timeoutMs: number;
}): Promise<ForegroundShellCommandResult> {
  const commandAbortController = new AbortController();
  let interruptedByRequest = false;
  const interruptMonitor = startCommandInterruptMonitor({
    runId: input.ctx.runId,
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
      shell: config.runtime.shell,
      command: input.command,
      taskDir: input.ctx.taskDir,
      envRoot: input.ctx.envRoot,
      envOverrides: input.ctx.shellEnvOverrides,
      timeoutMs: input.timeoutMs,
      maxOutputKb: config.runtime.maxCommandOutputKb,
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
  state: ToolDispatchState;
  execution: BuiltinExecution;
  command: string;
  error: unknown;
}): Promise<void> {
  rethrowIfTaskCancelled(input.error);
  const message = `Failed to run shell command: ${getErrorMessage(input.error)}`;
  const durationMs = Date.now() - input.execution.startedAtMs;
  await finishBuiltinToolFailure(input.ctx, input.state, input.execution, message, {
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
  state: ToolDispatchState;
  execution: BuiltinExecution;
  command: string;
  shellResult: ShellExecutionResult & { cwd: string; stateReset: boolean };
  interruptedByRequest: boolean;
  outputLimits: ShellOutputLimits;
}): Promise<void> {
  const durationMs = Date.now() - input.execution.startedAtMs;
  const stdout = formatShellOutput(
    input.shellResult.stdout,
    input.shellResult.stdoutLength,
    input.outputLimits
  );
  const stderr = formatShellOutput(
    input.shellResult.stderr,
    input.shellResult.stderrLength,
    input.outputLimits
  );

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

    await finishBuiltinToolSuccess(input.ctx, input.state, input.execution, toolResult, {
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
    return;
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

  await finishBuiltinToolSuccess(input.ctx, input.state, input.execution, toolResult, {
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
): Promise<void> {
  if (typeof args.command !== "string") {
    pushParseError(state, outputItem.call_id, "command is required for foreground run_shell calls.");
    return;
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
      state,
      execution,
      command: args.command,
      timeoutMs
    });
  } catch (error) {
    await finishForegroundShellFailure({
      ctx,
      state,
      execution,
      command: args.command,
      error
    });
    return;
  }

  if (result.shellResult.aborted && !result.interruptWasConsumed) {
    throw new Error("TASK_CANCELLED");
  }
  await ctx.assertNotCancelled();

  await finishForegroundShellResult({
    ctx,
    state,
    execution,
    command: args.command,
    shellResult: result.shellResult,
    interruptedByRequest: result.interruptedByRequest,
    outputLimits: resolveOutputLimits(args)
  });
}

export async function handleRunShell(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  await ctx.assertNotCancelled();
  const shellTimeoutMaxSeconds = Math.max(1, Math.floor(ctx.shellToolMaxTimeoutMs / 1000));
  const parsed = parseToolArguments(
    RUN_SHELL_TOOL_NAME,
    outputItem.arguments,
    createRunShellArgumentsSchema(shellTimeoutMaxSeconds)
  );
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
  }

  await ctx.assertNotCancelled();

  if (parsed.value.background === true || parsed.value.background_id) {
    pushParseError(
      state,
      outputItem.call_id,
      "run_shell background mode was replaced by persistent shell_session. Start a session, then use run_shell with session_id."
    );
    return;
  }

  if (parsed.value.session_id) {
    if (typeof parsed.value.command !== "string") {
      pushParseError(state, outputItem.call_id, "command is required when session_id is provided.");
      return;
    }
    await handlePersistentRunShell({
      outputItem,
      ctx,
      state,
      command: parsed.value.command,
      sessionId: parsed.value.session_id,
      force: parsed.value.force === true
    });
    return;
  }

  await handleForegroundShell(outputItem, ctx, state, parsed.value);
}


export function handleFinalResponse(
  outputItem: ResponseFunctionToolCall,
  state: ToolDispatchState
): { response: string; notify: boolean; partial: boolean; summary?: string } | null {
  const parsed = parseToolArguments(FINAL_RESPONSE_TOOL_NAME, outputItem.arguments, finalResponseArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return null;
  }

  validateOrganizationFinalResponse(parsed.value, state);
  const notify = parsed.value.notify ?? true;
  const partial = parsed.value.partial ?? false;
  pushToolOutput(state, outputItem.call_id, outputItem.name, { acknowledged: true, notify, partial });
  return {
    response: parsed.value.response.trim(),
    ...(state.organization && parsed.value.summary ? { summary: parsed.value.summary.trim() } : {}),
    notify,
    partial
  };
}

export async function handleRefreshGitHubToken(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  const parsed = parseToolArguments(
    REFRESH_GH_TOKEN_TOOL_NAME,
    outputItem.arguments,
    refreshGhTokenArgumentsSchema
  );
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Action",
    inputText: "Refresh GitHub token"
  });

  if (!ctx.refreshGitHubToken) {
    await finishBuiltinToolFailure(
      ctx,
      state,
      execution,
      "GitHub token refresh is unavailable for this run."
    );
    return;
  }

  const result = await ctx.refreshGitHubToken();
  if (!result.ok) {
    await finishBuiltinToolFailure(
      ctx,
      state,
      execution,
      result.error ?? "Failed to refresh GitHub token.",
      { output: result }
    );
    return;
  }

  await finishBuiltinToolSuccess(ctx, state, execution, result, {
    eventPayload: result.login ? { login: result.login } : {}
  });
}

import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { config } from "../../../lib/config.js";
import {
  SHELL_SESSION_TOOL_NAME,
  shellSessionArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import {
  getPersistentShellSessionStatus,
  controlPersistentShellSession,
  buildPersistentShellEnvironment,
  listPersistentShellSessions,
  runPersistentShellCommand,
  startPersistentShellSession,
  stopPersistentShellSession
} from "../../runtime/persistent-shell-sessions.js";
import {
  finishBuiltinToolFailure,
  finishBuiltinToolSuccess,
  startBuiltinToolExecution,
  type BuiltinToolExecution
} from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { getErrorMessage } from "../utils.js";

function getPersistentContext(ctx: ToolDispatchContext) {
  if (!ctx.persistentRuntimeEnabled) {
    throw new Error("Persistent project shell sessions are disabled for this project.");
  }
  if (!ctx.actorUserId) {
    throw new Error("Persistent project shell sessions require an authenticated user.");
  }
  return {
    taskId: ctx.taskId,
    workspaceId: ctx.workspaceId,
    environmentId: ctx.environmentId,
    creatorUserId: ctx.actorUserId,
    taskDir: ctx.taskDir,
    envRoot: ctx.envRoot,
    workspaceRoot: ctx.workspaceRoot,
    workingDir: ctx.envRoot,
    networkEnabled: ctx.shellNetworkEnabled,
    runAsRoot: ctx.workspaceRunAsRoot === true,
    shell: config.runtime.shell,
    env: buildPersistentShellEnvironment({
      taskDir: ctx.taskDir,
      envRoot: ctx.envRoot,
      workspaceRoot: ctx.workspaceRoot,
      workingDir: ctx.envRoot,
      envOverrides: ctx.shellEnvOverrides
    })
  };
}

async function handlePersistentShellList(
  ctx: ToolDispatchContext,
  execution: BuiltinToolExecution
): Promise<ToolCallResult> {
  const sessions = await listPersistentShellSessions({ environmentId: ctx.environmentId });
  return finishBuiltinToolSuccess(ctx, execution, {
    sessions: sessions.map((session) => ({
      session_id: session.id,
      status: session.status,
      command: session.command,
      cwd: session.workingDir,
      mode: session.mode,
      started_at: session.startedAt,
      updated_at: session.updatedAt,
      command_id: session.commandId,
      exit_code: session.exitCode,
      output_truncated: session.outputTruncated,
      lifetime_seconds: session.lifetimeSeconds,
      expires_at: session.expiresAt
    }))
  });
}

async function handlePersistentShellStatus(
  ctx: ToolDispatchContext,
  execution: BuiltinToolExecution,
  sessionId: string,
  tailLines?: number | null,
  saveOutputPath?: string | null
): Promise<ToolCallResult> {
  const result = await getPersistentShellSessionStatus({
    sessionId,
    environmentId: ctx.environmentId,
    taskDir: ctx.taskDir,
    tailLines,
    saveOutputPath
  });
  return finishBuiltinToolSuccess(ctx, execution, {
    session_id: result.sessionId,
    status: result.status,
    command: result.command,
    output: result.output,
    output_file: result.outputFile,
    started_at: result.startedAt,
    completed_at: result.completedAt,
    stopped_at: result.stoppedAt,
    stop_reason: result.stopReason,
    mode: result.mode,
    command_id: result.commandId,
    exit_code: result.exitCode,
    cwd: result.cwd,
    output_truncated: result.outputTruncated,
    lifetime_seconds: result.lifetimeSeconds,
    expires_at: result.expiresAt
  });
}

export async function handleShellSession(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const parsed = parseToolArguments(SHELL_SESSION_TOOL_NAME, outputItem.arguments, shellSessionArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Persistent shell session",
    inputText: parsed.value.action
  });
  try {
    const persistentContext = getPersistentContext(ctx);
    if (parsed.value.action === "list") {
      return await handlePersistentShellList(ctx, execution);
    }
    if (parsed.value.action === "start") {
      const lifetimeSeconds = parsed.value.lifetime_seconds ?? parsed.value.lifetime ?? null;
      const result = await startPersistentShellSession({
        ...persistentContext,
        command: parsed.value.command,
        mode: parsed.value.mode,
        lifetimeSeconds
      });
      return await finishBuiltinToolSuccess(ctx, execution, {
        session_id: result.sessionId,
        status: parsed.value.command ? "running" : "idle",
        lifetime_seconds: result.lifetimeSeconds,
        expires_at: result.expiresAt,
        sandbox_limits: {
          memory_mb: result.limits.memoryMb,
          cpus: result.limits.cpus,
          pids: result.limits.pids
        }
      });
    }
    if (parsed.value.action === "stop") {
      await stopPersistentShellSession({
        sessionId: parsed.value.session_id!,
        environmentId: ctx.environmentId
      });
      return await finishBuiltinToolSuccess(ctx, execution, { status: "stopped" });
    }
    if (["input", "interrupt", "eof", "resize"].includes(parsed.value.action)) {
      const result = await controlPersistentShellSession({
        sessionId: parsed.value.session_id!, environmentId: ctx.environmentId,
        action: parsed.value.action as "input" | "interrupt" | "eof" | "resize",
        data: parsed.value.data, cols: parsed.value.cols, rows: parsed.value.rows
      });
      return await finishBuiltinToolSuccess(ctx, execution, {
        session_id: parsed.value.session_id, status: result.status,
        command_id: result.commandId, exit_code: result.exitCode, cwd: result.cwd,
        mode: result.mode, output_truncated: result.outputTruncated,
        bytes_accepted: result.bytesAccepted, complete: result.complete,
        status_sync_pending: result.statusSyncPending
      });
    }
    return await handlePersistentShellStatus(
      ctx,
      execution,
      parsed.value.session_id!,
      parsed.value.tail_lines,
      parsed.value.save_output_path
    );
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
    const result = await runPersistentShellCommand({
      ...getPersistentContext(input.ctx),
      command: input.command,
      sessionId: input.sessionId,
      force: input.force
    });
    return await finishBuiltinToolSuccess(input.ctx, execution, {
      session_id: result.sessionId,
      status: result.status,
      command: input.command,
      background: true,
      command_id: result.commandId
    });
  } catch (error) {
    return finishBuiltinToolFailure(input.ctx, execution, getErrorMessage(error));
  }
}

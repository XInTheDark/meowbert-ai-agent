import fs from "node:fs";
import path from "node:path";
import type { DockerSandboxHandle } from "@meowbert/shared/docker-sandbox";
import { assertTaskWritePath, ensureSandboxWritablePath, isWithinPath } from "@meowbert/shared";
import { resolveTaskInputDir } from "../tasks/task-paths.js";


export interface ShellExecutionInput {
  sandbox: DockerSandboxHandle;
  shell: string;
  command: string;
  taskDir: string;
  envRoot: string;
  envOverrides?: Record<string, string>;
  timeoutMs: number;
  maxOutputKb: number;
  abortSignal?: AbortSignal;
}

export interface ShellExecutionResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
  stdoutLength?: number;
  stderrLength?: number;
  sandboxCrash?: string | null;
}

function buildShellEnvironment(taskDir: string, envRoot: string, envOverrides?: Record<string, string>): Record<string, string> {
  return {
    TASK_DIR: path.resolve(taskDir),
    ENV_ROOT: path.resolve(envRoot),
    TASK_INPUT_DIR: resolveTaskInputDir(taskDir),
    PWD: path.resolve(taskDir),
    HOME: path.resolve(envRoot),
    ...(envOverrides ?? {})
  };
}

export async function ensureTaskWorkspace(taskDir: string, envRoot: string): Promise<void> {
  const resolvedTaskDir = path.resolve(taskDir);
  const resolvedEnvRoot = path.resolve(envRoot);

  if (!isWithinPath(resolvedEnvRoot, resolvedTaskDir)) {
    throw new Error(`Task workspace must be nested inside environment root: ${resolvedTaskDir}`);
  }

  fs.mkdirSync(taskDir, { recursive: true });
  const taskInputDir = resolveTaskInputDir(resolvedTaskDir);
  fs.mkdirSync(taskInputDir, { recursive: true });
  assertTaskWritePath(
    {
      taskDir: resolvedTaskDir,
      envRoot: resolvedEnvRoot
    },
    resolvedTaskDir
  );

  await ensureSandboxWritablePath({
    rootPath: resolvedEnvRoot,
    targetPath: resolvedTaskDir,
    recursive: true
  });
}

export function executeShellCommand(input: ShellExecutionInput): Promise<ShellExecutionResult> {
  return input.sandbox.executeShellCommand({
    shell: input.shell,
    command: input.command,
    workingDir: input.taskDir,
    env: buildShellEnvironment(input.taskDir, input.envRoot, input.envOverrides),
    timeoutMs: input.timeoutMs,
    maxOutputKb: input.maxOutputKb,
    abortSignal: input.abortSignal
  });
}

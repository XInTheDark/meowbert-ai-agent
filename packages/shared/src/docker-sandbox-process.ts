import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Exec } from "dockerode";

export const FORCE_KILL_DELAY_MS = 500;
export const DEFAULT_EXEC_CLOSE_TIMEOUT_MS = 5_000;

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function buildSandboxStateFilePath(): string {
  return path.posix.join("/tmp", "meowbert-sandbox-state", `${randomUUID()}.pid`);
}

function quoteShellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function joinShellScriptLines(lines: string[]): string {
  return lines.join("\n");
}

// Runs the command with umask 0002, like the API and worker, so files the sandbox creates are
// group-writable and stay writable for the sandbox when the API copies them (e.g. task forks).
export function withGroupWritableUmask(command: string[]): string[] {
  return ["/bin/sh", "-c", 'umask 0002 && exec "$@"', "sh", ...command];
}

export function buildWrappedCommand(input: {
  command: string[];
  pidFilePath: string;
}): string[] {
  const [executable, ...args] = input.command;
  const commandParts = [quoteShellLiteral(executable), ...args.map((arg) => quoteShellLiteral(arg))].join(" ");
  const script = joinShellScriptLines([
    "set -euo pipefail",
    `pid_file=${quoteShellLiteral(input.pidFilePath)}`,
    'mkdir -p "$(dirname "$pid_file")"',
    'cleanup() { rm -f "$pid_file"; }',
    "trap cleanup EXIT",
    `setsid ${commandParts} &`,
    'child_pid="$!"',
    'echo "$child_pid" > "$pid_file"',
    'wait "$child_pid"'
  ]);

  return ["/bin/bash", "-lc", script];
}

export function buildKillCommand(pidFilePath: string, signal: "TERM" | "KILL"): string[] {
  const signalValue = signal === "KILL" ? "KILL" : "TERM";
  const script = joinShellScriptLines([
    "set +e",
    `pid_file=${quoteShellLiteral(pidFilePath)}`,
    'pid="$(cat "$pid_file" 2>/dev/null || true)"',
    'if [ -n "$pid" ]; then',
    `  kill -s ${signalValue} -- "-$pid" 2>/dev/null || kill -s ${signalValue} "$pid" 2>/dev/null || true`,
    "fi"
  ]);

  return ["/bin/bash", "-lc", script];
}

export async function waitForExecExit(exec: Exec, timeoutMs?: number | null): Promise<number | null> {
  const startedAt = Date.now();
  while (timeoutMs == null || Date.now() - startedAt < timeoutMs) {
    const inspected = await exec.inspect();
    if (inspected.Running !== true) {
      return typeof inspected.ExitCode === "number" ? inspected.ExitCode : null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

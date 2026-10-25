import fs from "node:fs/promises";
import path from "node:path";
import type { MachineHandle, SandboxExecCommandInput, SandboxExecCommandResult } from "@meowbert/shared/docker-sandbox";
import type { MachineProvider } from "@meowbert/run-executor/agent/ports/machine-host";
import { HostProcesses } from "./host-processes";

export function hostShellCommand(shell: string, command: string): string[] {
  return process.platform === "win32"
    ? [shell, "-NoProfile", "-NonInteractive", "-Command", command]
    : [shell, "-lc", command];
}

export async function executeHostCommand(processes: HostProcesses, input: SandboxExecCommandInput): Promise<SandboxExecCommandResult> {
  input.abortSignal?.throwIfAborted();
  const attached = await processes.start({ ...input, command: hostShellCommand(input.shell, input.command), tty: false });
  let stdout = ""; let stderr = ""; let timedOut = false; let aborted = false;
  const limit = input.maxOutputKb * 1024;
  attached.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(0, limit); });
  attached.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(0, limit); });
  const abort = () => { aborted = true; void attached.close(); };
  const timer = setTimeout(() => { timedOut = true; void attached.close(); }, input.timeoutMs);
  input.abortSignal?.addEventListener("abort", abort, { once: true });
  if (input.abortSignal?.aborted) abort();
  try {
    const exitCode = await attached.waitForExit();
    return { command: input.command, stdout, stderr, exitCode: exitCode ?? (timedOut ? 124 : aborted ? 130 : 1), timedOut, aborted };
  } finally { clearTimeout(timer); input.abortSignal?.removeEventListener("abort", abort); }
}

export function createHostMachineProvider(options: { scratchRoot: string; runsRoot: string; consent: boolean }): MachineProvider {
  return {
    async prepareScratchDir({ workspaceId, taskId }) {
      const dir = path.join(options.scratchRoot, workspaceId, taskId);
      await fs.mkdir(dir, { recursive: true });
      return dir;
    },
    async start(spec) {
      if (!options.consent) throw new Error("Host mode requires consent on this device.");
      if (spec.isThreadTask) throw new Error("Read-only threads require the sandbox.");
      await fs.mkdir(spec.taskDir, { recursive: true });
      const processes = new HostProcesses(path.join(options.runsRoot, spec.runId + ".pids"), spec.env);
      const sandbox: MachineHandle = {
        id: "host-" + spec.runId, kind: "host",
        getMappedHostPort: async (port) => port, readCrashReport: async () => null,
        executeShellCommand: (input) => executeHostCommand(processes, input),
        startAttachedProcess: (input) => processes.start(input), stop: () => processes.stop()
      };
      return { sandbox, initialize: async () => ({ alreadyInitialized: true }), stop: () => sandbox.stop() };
    }
  };
}

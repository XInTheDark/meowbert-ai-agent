import type { DockerSandboxManager } from "./docker-sandbox.js";

export interface PersistentShellRuntimeState {
  status: "running" | "idle" | "completed";
  mode: "terminal" | "pipe";
  commandId: string | null;
  command: string;
  exitCode: number | null;
  cwd: string;
  outputTruncated: boolean;
}

export interface PersistentShellRuntimeTarget {
  id: string;
  container_id: string | null;
  working_dir: string;
}

export async function requestPersistentShellRuntime<T = PersistentShellRuntimeState>(
  manager: Pick<DockerSandboxManager, "attachPersistentSandbox">,
  session: PersistentShellRuntimeTarget,
  request: Record<string, unknown>,
  action: "launch" | "request" = "request"
): Promise<T> {
  if (!session.container_id) throw new Error("Persistent shell container is unavailable.");
  const sandbox = await manager.attachPersistentSandbox({
    containerId: session.container_id,
    workingDir: session.working_dir
  });
  const payload = Buffer.from(JSON.stringify({
    directory: `/tmp/meowbert-shell-${session.id}`,
    ...request
  })).toString("base64");
  const result = await sandbox.executeShellCommand({
    shell: "/bin/bash",
    command: `python3 /opt/meowbert/persistent-shell/main.py ${action} '${payload}'`,
    workingDir: session.working_dir,
    timeoutMs: 10_000,
    maxOutputKb: 1024
  });
  if (result.exitCode !== 0 || result.timedOut) {
    const summary = action === "launch"
      ? "Persistent shell startup failed. Check the sandbox runtime image and startup diagnostics."
      : "Persistent shell request failed; delivery may be uncertain. Inspect status before retrying input.";
    const detail = result.stderr.trim().slice(-4096);
    throw new Error(`${summary} ${result.timedOut ? "Request timed out." : `Exit code: ${result.exitCode}.`}${detail ? `\n${detail}` : ""}`);
  }
  const response = JSON.parse(result.stdout) as { ok: boolean; result: T; error?: string };
  if (!response.ok) throw new Error(response.error ?? "Persistent shell request failed.");
  return response.result;
}

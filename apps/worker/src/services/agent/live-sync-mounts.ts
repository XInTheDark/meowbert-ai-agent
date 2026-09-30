import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { DockerSandboxHandle, SandboxMountPath } from "@meowbert/shared/docker-sandbox";

const execFile = promisify(execFileCallback);

export async function prepareTaskSourceMounts(mountPaths: string[], readOnly: boolean): Promise<SandboxMountPath[]> {
  await Promise.all(mountPaths.map(async (mountPath) => {
    try {
      await execFile("mountpoint", ["-q", "--", mountPath], { timeout: 2_000, killSignal: "SIGKILL" });
    } catch {
      throw new Error(`Attached Google Drive folder is unavailable to the worker (${mountPath}). API and worker must share the runtime bind with mount propagation enabled (rshared); check the effective container mounts before retrying this task.`);
    }
  }));
  // Give each source its own bind: gVisor exposes a parent bind as one filesystem.
  return mountPaths.map((mountPath) => ({ path: mountPath, readOnly }));
}

export async function verifyTaskSourceMounts(
  sandbox: Pick<DockerSandboxHandle, "executeShellCommand">,
  mountPaths: string[],
  taskDir: string
): Promise<void> {
  if (mountPaths.length === 0) return;
  const quotedPaths = mountPaths.map((value) => `'${value.replace(/'/g, "'\\''")}'`).join(" ");
  // Check mount metadata only; an empty local directory must not masquerade as Drive.
  const result = await sandbox.executeShellCommand({
    command: `for folder in ${quotedPaths}; do mountpoint -q -- "$folder" || exit 1; done`,
    shell: "/bin/sh",
    workingDir: taskDir,
    timeoutMs: 5_000,
    maxOutputKb: 1
  });
  if (result.exitCode !== 0 || result.timedOut || result.aborted) {
    const folders = mountPaths.map((value) => path.relative(taskDir, value)).join(", ");
    throw new Error(`Attached Google Drive folders are unavailable in the task sandbox (${folders}). API and worker must share the runtime bind with mount propagation enabled (rshared); check the effective container mounts before retrying this task.`);
  }
}

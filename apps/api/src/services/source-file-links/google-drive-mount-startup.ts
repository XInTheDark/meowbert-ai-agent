import type { ChildProcess } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { SourceFileLinkProviderError } from "./provider-errors.js";

const execFile = promisify(execFileCallback);
const READY_TIMEOUT_MS = 10_000;

function startupError(stderr: string): SourceFileLinkProviderError {
  // Only expose known diagnoses: rclone output can contain credentials and paths.
  const message = /fusermount|libfuse|\/dev\/fuse|fuse:|mount.*permission denied|mount.*operation not permitted/i.test(stderr)
    ? "Google Drive live folders require FUSE support on the server. Ask the server admin to check the FUSE installation and mount permissions."
    : /invalid_grant|invalid_client|unauthorized_client/i.test(stderr)
      ? "Google Drive could not authorize the live folder. Reconnect the workspace Google Drive account and try again."
      : "Google Drive could not mount the live folder. Please retry or ask the server admin to check the mount setup.";
  return new SourceFileLinkProviderError(message, { statusCode: 503, retryable: true });
}

export async function waitForGoogleDriveMount(child: ChildProcess, mountPoint: string): Promise<void> {
  let stderr = "";
  let failure: SourceFileLinkProviderError | null = null;
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-8_192);
  });
  child.once("error", () => {
    failure = new SourceFileLinkProviderError(
      "Google Drive could not start the live folder mount. Ask the server admin to check the rclone installation.",
      { statusCode: 503 }
    );
  });
  child.once("exit", () => { failure ??= startupError(stderr); });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    if (child.exitCode !== null || child.signalCode !== null) throw startupError(stderr);
    try {
      await execFile("mountpoint", ["-q", mountPoint], {
        timeout: Math.min(1_000, deadline - Date.now()),
        killSignal: "SIGKILL"
      });
      if (failure) throw failure;
      // Mount readiness must not enumerate or download the remote folder.
      return;
    } catch {
      if (failure) throw failure;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new SourceFileLinkProviderError(
    "Google Drive took too long to mount the live folder. Please try again.",
    { statusCode: 503, retryable: true }
  );
}

import type { ChildProcess } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { SourceFileLinkProviderError } from "./provider-errors.js";

const execFile = promisify(execFileCallback);
const READY_TIMEOUT_MS = 10_000;
const EXIT_DRAIN_MS = 500;

const GOOGLE_DRIVE_FOLDER_MISSING_MESSAGE =
  "The attached Google Drive folder no longer exists or is not shared with the connected account. Remove it from the project and attach it again.";

// Strip OAuth tokens and client secrets before rclone output reaches the server log.
function redactRcloneOutput(output: string): string {
  return output
    .replace(/"(access_token|refresh_token|client_secret|id_token)"\s*:\s*"[^"]*"/gi, "\"$1\":\"[redacted]\"")
    .replace(/ya29\.[\w.-]+/g, "[redacted]")
    .replace(/1\/\/[\w.-]{20,}/g, "[redacted]")
    .replace(/GOCSPX-[\w-]+/g, "[redacted]");
}

// rclone's last error line, redacted, with log timestamps and the server mount path removed.
function summarizeRcloneError(stderr: string, mountPoint: string): string | null {
  const lines = redactRcloneOutput(stderr).split("\n").map((line) => line.trim()).filter(Boolean);
  const errorLine = [...lines].reverse().find((line) => /fatal error|critical|error/i.test(line)) ?? lines.at(-1);
  if (!errorLine) return null;
  const summary = errorLine
    .replace(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\s*/, "")
    .split(mountPoint).join("the live folder");
  return summary.length > 300 ? `${summary.slice(0, 300)}…` : summary;
}

function startupError(stderr: string, mountPoint: string): SourceFileLinkProviderError {
  console.error(`[google-drive] rclone mount failed for ${mountPoint}:\n${redactRcloneOutput(stderr).trim() || "(no output)"}`);
  if (/fusermount|libfuse|\/dev\/fuse|fuse:|mount.*permission denied|mount.*operation not permitted/i.test(stderr)) {
    return new SourceFileLinkProviderError(
      "Google Drive live folders require FUSE support on the server. Ask the server admin to check the FUSE installation and mount permissions.",
      { statusCode: 503, retryable: true }
    );
  }
  if (/invalid_grant|invalid_client|unauthorized_client/i.test(stderr)) {
    return new SourceFileLinkProviderError(
      "Google Drive could not authorize the live folder. Reconnect the workspace Google Drive account and try again.",
      { statusCode: 503 }
    );
  }
  if (/couldn't find root directory ID|Error 404|notFound/i.test(stderr)) {
    return new SourceFileLinkProviderError(GOOGLE_DRIVE_FOLDER_MISSING_MESSAGE, { statusCode: 409 });
  }
  if (/already mounted/i.test(stderr)) {
    return new SourceFileLinkProviderError(
      "An old Google Drive mount is still attached to the live folder. Restart the API service to clear it, then retry.",
      { statusCode: 503, retryable: true }
    );
  }
  const detail = summarizeRcloneError(stderr, mountPoint);
  return new SourceFileLinkProviderError(
    detail
      ? `Google Drive could not mount the live folder. rclone said: ${detail}`
      : "Google Drive could not mount the live folder, and rclone exited without an error message.",
    { statusCode: 503, retryable: true }
  );
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
  // "close" fires once stderr is drained, so the diagnosis sees rclone's final error line.
  child.once("close", () => { failure ??= startupError(stderr, mountPoint); });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exitedAt: number | null = null;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    if (child.exitCode !== null || child.signalCode !== null) {
      exitedAt ??= Date.now();
      if (Date.now() - exitedAt >= EXIT_DRAIN_MS) throw (failure = startupError(stderr, mountPoint));
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
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

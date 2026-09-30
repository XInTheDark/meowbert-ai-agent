import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

const LIVE_SYNC_HELPER_PATH = "/usr/local/bin/meowbert-safe-live-sync";

function unavailableHelperError(message: string): Error {
  return new Error(`Live sync is unavailable: ${message}`);
}

async function assertLiveSyncHelperAvailable(): Promise<void> {
  if (process.platform !== "linux") {
    throw unavailableHelperError("the secure filesystem helper requires Linux");
  }
  await fsPromises.access(LIVE_SYNC_HELPER_PATH, fs.constants.X_OK).catch(() => {
    throw unavailableHelperError("the secure filesystem helper is not installed");
  });
}

async function runLiveSyncHelper(input: {
  args: string[];
  stdin?: Readable;
}): Promise<void> {
  await assertLiveSyncHelperAvailable();
  const child = spawn(LIVE_SYNC_HELPER_PATH, input.args, {
    stdio: [input.stdin ? "pipe" : "ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Secure live sync helper failed (${signal ?? code ?? "unknown"}): ${stderr.trim() || "no error output"}`));
    });
  });

  const streams: Promise<void>[] = [];
  if (input.stdin && child.stdin) {
    streams.push(pipeline(input.stdin, child.stdin));
  }
  await Promise.all([...streams, exited]);
}

export async function snapshotLiveSyncPath(input: {
  environmentRootPath: string;
  localRelativePath: string;
  stagedPath: string;
}): Promise<void> {
  await runLiveSyncHelper({
    args: ["snapshot", input.environmentRootPath, input.localRelativePath, input.stagedPath]
  });
}

export async function replaceLiveSyncFileFromPath(input: {
  environmentRootPath: string;
  localRelativePath: string;
  sourcePath: string;
}): Promise<void> {
  await runLiveSyncHelper({
    args: ["write-file", input.environmentRootPath, input.localRelativePath],
    stdin: fs.createReadStream(input.sourcePath)
  });
}

export async function createLiveSyncFileFromPath(input: {
  environmentRootPath: string;
  localRelativePath: string;
  sourcePath: string;
  createParents: boolean;
}): Promise<void> {
  await runLiveSyncHelper({
    args: [input.createParents ? "write-new-file" : "write-new-file-existing-parent", input.environmentRootPath, input.localRelativePath],
    stdin: fs.createReadStream(input.sourcePath)
  });
}

export async function replaceLiveSyncDirectoryFromPath(input: {
  environmentRootPath: string;
  localRelativePath: string;
  stagedPath: string;
  createParents?: boolean;
}): Promise<void> {
  await runLiveSyncHelper({
    args: [input.createParents === false ? "replace-tree-existing-parent" : "replace-tree", input.environmentRootPath, input.localRelativePath, input.stagedPath]
  });
}

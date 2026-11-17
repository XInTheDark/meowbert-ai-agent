import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { STORAGE_FILE_PROGRAM } from "./storage-file-program.js";

interface StorageFileOperation {
  operation: "preview" | "upload";
  rootPath: string;
  relativePath: string;
  limitBytes: number;
  writable?: boolean;
  createDirectories?: boolean;
}

// stdin carries file bytes; fd 3 commits only after the multipart stream finishes
// without truncation. The helper owns open descriptors through metadata and cleanup.
export async function runStorageFileOperation<T>(
  input: StorageFileOperation,
  file?: Readable & { truncated?: boolean }
): Promise<T> {
  const child = spawn("python3", ["-I", "-c", STORAGE_FILE_PROGRAM, JSON.stringify(input)], {
    stdio: ["pipe", "pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const verdict = child.stdio[3] as Writable;
  verdict.on("error", () => {});
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) return resolve();
      let message = stderr.trim() || "Secure storage file operation failed";
      try { message = (JSON.parse(message) as { error: string }).error; } catch { /* Interpreter startup error. */ }
      reject(new Error(message));
    });
  });
  const streamed = file
    ? pipeline(file, child.stdin).then(() => { verdict.end(file.truncated ? "0" : "1"); }, (error: unknown) => {
      verdict.end("0");
      throw error;
    })
    : Promise.resolve().then(() => { child.stdin.end(); verdict.end("1"); });
  const [execution, stream] = await Promise.allSettled([exited, streamed]);
  if (execution.status === "rejected" && !(execution.reason instanceof Error && execution.reason.message === "UPLOAD_ABORTED")) throw execution.reason;
  if (stream.status === "rejected") throw stream.reason;
  if (execution.status === "rejected") throw execution.reason;
  return JSON.parse(stdout) as T;
}

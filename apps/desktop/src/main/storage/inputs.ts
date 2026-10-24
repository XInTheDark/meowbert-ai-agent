import fs from "node:fs/promises";
import path from "node:path";
import { isWithinPath } from "@meowbert/shared";
import { sha256File } from "@meowbert/shared/server-security";
import type { RunBootstrap } from "@meowbert/run-executor/agent/ports/run-bootstrap";

export class StorageNotReadyError extends Error {}

async function inputsVisible(taskDir: string, inputs: NonNullable<RunBootstrap["inputs"]>, signal: AbortSignal): Promise<boolean> {
  const root = await fs.realpath(taskDir);
  for (const input of inputs) {
    const lexicalPath = path.resolve(root, input.relativePath);
    if (path.isAbsolute(input.relativePath) || !isWithinPath(root, lexicalPath)) throw new Error("Input path escapes the task directory.");
    const file = await fs.realpath(lexicalPath);
    if (!isWithinPath(root, file)) throw new Error("Input symlink escapes the task directory.");
    const stats = await fs.stat(file);
    if (!stats.isFile() || stats.size !== input.sizeBytes || await sha256File(file, signal) !== input.sha256) return false;
  }
  return true;
}

export async function waitForRunInputs(input: {
  taskDir: string; inputs: RunBootstrap["inputs"]; signal: AbortSignal; timeoutMs?: number; retryMs?: number;
}): Promise<void> {
  if (!input.inputs) throw new Error("The server did not provide an input manifest. Update the server.");
  if (!input.inputs.length) return;
  const deadline = Date.now() + (input.timeoutMs ?? 30_000);
  do {
    input.signal.throwIfAborted();
    try {
      if (await inputsVisible(input.taskDir, input.inputs, input.signal)) return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["ENOENT", "EIO", "ESTALE", "ENOTCONN", "ETIMEDOUT", "EACCES"].includes(code ?? "")) throw error;
    }
    if (Date.now() >= deadline) break;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(input.signal.reason); };
      const timer = setTimeout(() => { input.signal.removeEventListener("abort", abort); resolve(); }, Math.min(input.retryMs ?? 1_000, deadline - Date.now()));
      input.signal.addEventListener("abort", abort, { once: true });
    });
  } while (Date.now() <= deadline);
  throw new StorageNotReadyError("Waiting for storage: run inputs are not visible or do not match their upload hashes.");
}

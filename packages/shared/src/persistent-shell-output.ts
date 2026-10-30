import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isWithinPath } from "./path-containment.mjs";
import { stripAnsi } from "./ansi.js";
import {
  DEFAULT_SHELL_OUTPUT_WINDOW,
  SHELL_OUTPUT_TASK_BUDGET_BYTES,
  windowShellOutput
} from "./shell-output.js";

export function persistentShellLogPath(envRoot: string, sessionId: string): string {
  return path.resolve(envRoot, ".meowbert", "persistent-runtimes", `${sessionId}.log`);
}

export async function resolveSafeOutputPath(taskDir: string, relativePath: string): Promise<string> {
  const realTaskDir = await fs.realpath(taskDir);
  const target = path.resolve(realTaskDir, relativePath);
  if (!isWithinPath(realTaskDir, target)) {
    throw new Error("save_output_path must stay inside the current task directory.");
  }

  const relativeParent = path.relative(realTaskDir, path.dirname(target));
  let realParent = realTaskDir;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    const candidate = path.join(realParent, segment);
    await fs.mkdir(candidate, { recursive: true });
    realParent = await fs.realpath(candidate);
    if (!isWithinPath(realTaskDir, realParent)) {
      throw new Error("save_output_path must stay inside the current task directory.");
    }
  }

  return path.join(realParent, path.basename(target));
}

export async function writeSafeOutputFile(target: string, contents: string): Promise<void> {
  const temporaryPath = path.join(path.dirname(target), `.meowbert-output-${randomUUID()}.tmp`);
  const outputFileHandle = await fs.open(
    temporaryPath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o660
  );
  try {
    try {
      await outputFileHandle.writeFile(contents, "utf8");
    } finally {
      await outputFileHandle.close();
    }
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  await fs.rename(temporaryPath, target).catch(async (error) => {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  });
}

export async function readPersistentShellOutput(input: {
  logPath: string;
  taskDir: string;
  tailLines?: number | null;
  saveOutputPath?: string | null;
}): Promise<{ output: string; outputFile: string | null; outputVersion: string | null }> {
  const maxLines = Math.min(2_000, Math.max(1, Math.floor(input.tailLines ?? 200)));
  // Include timestamps and identity: rolling logs and repeated output can keep the same size/text.
  const stat = await fs.stat(input.logPath, { bigint: true }).catch(() => null);
  const outputVersion = stat ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` : null;
  const log = stripAnsi(await fs.readFile(input.logPath, "utf8").catch(() => ""));
  const lines = log.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  let outputFile: string | null = null;
  if (input.saveOutputPath) {
    if (path.isAbsolute(input.saveOutputPath) || !input.saveOutputPath.endsWith(".txt")) {
      throw new Error("save_output_path must be a task-relative .txt path.");
    }
    const target = await resolveSafeOutputPath(input.taskDir, input.saveOutputPath);
    await writeSafeOutputFile(target, log);
    outputFile = input.saveOutputPath;
  }
  const tailText = lines.slice(-maxLines).join("\n");
  // The log is itself the saved copy, so a long tail points at it instead of writing another.
  const savedTo = `$ENV_ROOT/.meowbert/persistent-runtimes/${path.basename(input.logPath)}`;
  return {
    output: windowShellOutput(tailText, tailText.length, DEFAULT_SHELL_OUTPUT_WINDOW, savedTo),
    outputFile,
    outputVersion
  };
}

async function evictOldestUntilFits(dir: string, incomingBytes: number, budgetBytes: number): Promise<void> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const files = (await Promise.all(names.map(async (name) => {
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    return stat?.isFile() ? { name, size: stat.size, mtimeMs: stat.mtimeMs } : null;
  }))).filter((file): file is { name: string; size: number; mtimeMs: number } => file !== null);
  let used = files.reduce((sum, file) => sum + file.size, 0) + incomingBytes;
  for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (used <= budgetBytes) return;
    await fs.rm(path.join(dir, file.name), { force: true });
    used -= file.size;
  }
}

// Saves output the model only partly saw. The directory is small and owned by the task, so reading
// it to enforce the budget is cheap.
export async function saveShellOutputFile(input: {
  dir: string;
  name: string;
  text: string;
  budgetBytes?: number;
}): Promise<string> {
  await fs.mkdir(input.dir, { recursive: true });
  await evictOldestUntilFits(input.dir, Buffer.byteLength(input.text), input.budgetBytes ?? SHELL_OUTPUT_TASK_BUDGET_BYTES);
  const target = path.join(input.dir, input.name);
  await writeSafeOutputFile(target, input.text);
  return target;
}

import { execFile } from "node:child_process";

const MIGRATION_FILESYSTEM_TIMEOUT_MS = 30 * 60_000;

// Recursive removal can occupy every libuv thread on a cloud mount, including
// the threads PostgreSQL hostname lookup needs. Keep bulk I/O in another process.
const MIGRATION_FILESYSTEM_SCRIPT = `
import fs from "node:fs/promises";
import path from "node:path";

const input = JSON.parse(process.argv[1]);
if (input.operation === "reset") {
  await fs.rm(input.rootPath, { recursive: true, force: true });
  await fs.mkdir(input.rootPath, { recursive: true });
} else if (input.operation === "copy") {
  const entries = await fs.readdir(input.sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    await fs.cp(path.join(input.sourceRoot, entry.name), path.join(input.targetRoot, entry.name), {
      recursive: true,
      errorOnExist: true,
      force: false
    });
  }
} else {
  throw new Error("Unknown migration filesystem operation");
}
`;

type MigrationFilesystemOperation =
  | { operation: "reset"; rootPath: string }
  | { operation: "copy"; sourceRoot: string; targetRoot: string };

function runMigrationFilesystemOperation(input: MigrationFilesystemOperation): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", MIGRATION_FILESYSTEM_SCRIPT, JSON.stringify(input)], {
      timeout: MIGRATION_FILESYSTEM_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      encoding: "utf8"
    }, (error, _stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      const detail = error.killed
        ? "exceeded the 30 minute filesystem operation limit"
        : stderr.trim() || error.message;
      reject(new Error(`Storage migration ${input.operation} failed: ${detail}`, { cause: error }));
    });
  });
}

export function resetManagedStorageRoot(rootPath: string): Promise<void> {
  return runMigrationFilesystemOperation({ operation: "reset", rootPath });
}

export function copyDirectoryContents(sourceRoot: string, targetRoot: string): Promise<void> {
  return runMigrationFilesystemOperation({ operation: "copy", sourceRoot, targetRoot });
}

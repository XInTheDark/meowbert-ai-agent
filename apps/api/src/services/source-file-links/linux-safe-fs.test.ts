import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { snapshotLiveSyncPath } from "./linux-safe-fs.js";

const executeFile = promisify(execFile);
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-openat2-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function compileTestHelper(directory: string): Promise<string> {
  const helperPath = path.join(directory, "meowbert-safe-live-sync-test");
  const helperSourcePath = fileURLToPath(new URL("../../../native/meowbert-safe-live-sync.c", import.meta.url));
  await executeFile("cc", ["-DMEOWBERT_SAFE_LIVE_SYNC_TEST_HOOK", "-O2", helperSourcePath, "-o", helperPath]);
  return helperPath;
}

async function startAtBarrier(input: {
  helperPath: string;
  args: string[];
  barrier: "before-root-open" | "after-root-open";
  acceptsStdin?: boolean;
}) {
  const child = spawn(input.helperPath, input.args, {
    env: {
      ...process.env,
      MEOWBERT_SAFE_LIVE_SYNC_TEST_BARRIER: input.barrier,
      MEOWBERT_SAFE_LIVE_SYNC_READY_FD: "3",
      MEOWBERT_SAFE_LIVE_SYNC_CONTINUE_FD: "4"
    },
    stdio: [input.acceptsStdin ? "pipe" : "ignore", "ignore", "pipe", "pipe", "pipe"]
  });
  const ready = child.stdio[3];
  const continueSignal = child.stdio[4];
  if (!ready || !continueSignal) {
    throw new Error("Unable to create live sync helper test barrier");
  }
  await once(ready, "data");
  return { child, continueSignal };
}

async function resumeBarrier(input: {
  child: ReturnType<typeof spawn>;
  continueSignal: NonNullable<ReturnType<typeof spawn>["stdio"][4]>;
  stdin?: string;
}): Promise<number | null> {
  const exit = once(input.child, "exit") as Promise<[number | null]>;
  if (input.stdin !== undefined) {
    input.child.stdin?.end(input.stdin);
  }
  input.continueSignal.end("1");
  const [exitCode] = await exit;
  return exitCode;
}

async function swapParentForOutsideSymlink(input: {
  rootPath: string;
  outsidePath: string;
}): Promise<void> {
  const parentPath = path.join(input.rootPath, "parent");
  await fsPromises.rename(parentPath, path.join(input.rootPath, "parent-original"));
  await fsPromises.symlink(input.outsidePath, parentPath);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fsPromises.rm(directory, { recursive: true, force: true })));
});

describe("secure live sync filesystem helper", () => {
  it.skipIf(process.platform === "linux")("fails closed when Linux openat2 support is unavailable", async () => {
    await expect(snapshotLiveSyncPath({
      environmentRootPath: "/tmp/environment",
      localRelativePath: "notes.txt",
      stagedPath: "/tmp/staged-notes.txt"
    })).rejects.toThrow("secure filesystem helper requires Linux");
  });

  it.skipIf(process.platform !== "linux")("rejects an environment-root ancestor symlink swap before snapshotting", async () => {
    const directory = await createTemporaryDirectory();
    const storagePath = path.join(directory, "storage");
    const rootPath = path.join(storagePath, "environment");
    const outsidePath = path.join(directory, "outside");
    const stagedPath = path.join(directory, "staged.txt");
    await fsPromises.mkdir(rootPath, { recursive: true });
    await fsPromises.mkdir(outsidePath);
    await fsPromises.writeFile(path.join(rootPath, "inside.txt"), "inside");
    await fsPromises.mkdir(path.join(outsidePath, "environment"));
    await fsPromises.writeFile(path.join(outsidePath, "environment", "inside.txt"), "outside");
    const helperPath = await compileTestHelper(directory);

    const barrier = await startAtBarrier({
      helperPath,
      args: ["snapshot", rootPath, "inside.txt", stagedPath],
      barrier: "before-root-open"
    });
    await fsPromises.rename(storagePath, path.join(directory, "storage-original"));
    await fsPromises.symlink(outsidePath, storagePath);

    await expect(resumeBarrier(barrier)).resolves.not.toBe(0);
    await expect(fsPromises.readFile(stagedPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fsPromises.readFile(path.join(outsidePath, "environment", "inside.txt"), "utf8")).resolves.toBe("outside");
  });

  it.skipIf(process.platform !== "linux")("rejects a parent-directory symlink swap for snapshots and file installs", async () => {
    const directory = await createTemporaryDirectory();
    const rootPath = path.join(directory, "environment");
    const outsidePath = path.join(directory, "outside");
    const stagedPath = path.join(directory, "staged.txt");
    await fsPromises.mkdir(path.join(rootPath, "parent"), { recursive: true });
    await fsPromises.mkdir(outsidePath);
    await fsPromises.writeFile(path.join(rootPath, "parent", "inside.txt"), "inside");
    await fsPromises.writeFile(path.join(outsidePath, "inside.txt"), "outside");
    const helperPath = await compileTestHelper(directory);

    const snapshotBarrier = await startAtBarrier({
      helperPath,
      args: ["snapshot", rootPath, "parent/inside.txt", stagedPath],
      barrier: "after-root-open"
    });
    await swapParentForOutsideSymlink({ rootPath, outsidePath });
    await expect(resumeBarrier(snapshotBarrier)).resolves.not.toBe(0);
    await expect(fsPromises.readFile(stagedPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await fsPromises.unlink(path.join(rootPath, "parent"));
    await fsPromises.rename(path.join(rootPath, "parent-original"), path.join(rootPath, "parent"));
    const writeBarrier = await startAtBarrier({
      helperPath,
      args: ["write-file", rootPath, "parent/inside.txt"],
      barrier: "after-root-open",
      acceptsStdin: true
    });
    await swapParentForOutsideSymlink({ rootPath, outsidePath });
    await expect(resumeBarrier({ ...writeBarrier, stdin: "replacement" })).resolves.not.toBe(0);
    await expect(fsPromises.readFile(path.join(outsidePath, "inside.txt"), "utf8")).resolves.toBe("outside");
  });

  it.skipIf(process.platform !== "linux")("rejects a parent-directory symlink swap for new-file and folder installs", async () => {
    const directory = await createTemporaryDirectory();
    const rootPath = path.join(directory, "environment");
    const outsidePath = path.join(directory, "outside");
    const stagedDirectory = path.join(directory, "staged-folder");
    await fsPromises.mkdir(path.join(rootPath, "parent"), { recursive: true });
    await fsPromises.mkdir(outsidePath);
    await fsPromises.mkdir(stagedDirectory);
    await fsPromises.writeFile(path.join(stagedDirectory, "new.txt"), "staged");
    const helperPath = await compileTestHelper(directory);

    const createBarrier = await startAtBarrier({
      helperPath,
      args: ["write-new-file", rootPath, "parent/new.txt"],
      barrier: "after-root-open",
      acceptsStdin: true
    });
    await swapParentForOutsideSymlink({ rootPath, outsidePath });
    await expect(resumeBarrier({ ...createBarrier, stdin: "new" })).resolves.not.toBe(0);
    await expect(fsPromises.access(path.join(outsidePath, "new.txt"))).rejects.toMatchObject({ code: "ENOENT" });

    await fsPromises.unlink(path.join(rootPath, "parent"));
    await fsPromises.rename(path.join(rootPath, "parent-original"), path.join(rootPath, "parent"));
    await fsPromises.mkdir(path.join(outsidePath, "folder"));
    await fsPromises.writeFile(path.join(outsidePath, "folder", "sentinel.txt"), "outside");
    const folderBarrier = await startAtBarrier({
      helperPath,
      args: ["replace-tree", rootPath, "parent/folder", stagedDirectory],
      barrier: "after-root-open"
    });
    await swapParentForOutsideSymlink({ rootPath, outsidePath });
    await expect(resumeBarrier(folderBarrier)).resolves.not.toBe(0);
    await expect(fsPromises.readFile(path.join(outsidePath, "folder", "sentinel.txt"), "utf8")).resolves.toBe("outside");
  });
});

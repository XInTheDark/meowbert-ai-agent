import { execFile, type ChildProcess } from "node:child_process";
import { lookup } from "node:dns/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

import { copyDirectoryContents, resetManagedStorageRoot } from "./migration-filesystem.js";

const actualChildProcess = await vi.importActual<typeof import("node:child_process")>("node:child_process");
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "migration-filesystem-"));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  vi.mocked(execFile).mockReset().mockImplementation(actualChildProcess.execFile);
  await Promise.all(tempDirs.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("migration filesystem process", () => {
  it("clears only the target and copies nested files without changing the source", async () => {
    const root = await makeTempDir();
    const source = path.join(root, "source with 'quotes' and $literal");
    const target = path.join(root, "target");
    await fs.mkdir(path.join(source, "nested"), { recursive: true });
    await fs.writeFile(path.join(source, "nested", "data.txt"), "source data");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "stale.txt"), "partial copy");

    await resetManagedStorageRoot(target);
    expect(await fs.readdir(target)).toEqual([]);
    await copyDirectoryContents(source, target);

    expect(await fs.readFile(path.join(target, "nested", "data.txt"), "utf8")).toBe("source data");
    expect(await fs.readFile(path.join(source, "nested", "data.txt"), "utf8")).toBe("source data");
  });

  it("propagates unreadable source and copy conflicts instead of reporting success", async () => {
    const root = await makeTempDir();
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await fs.mkdir(target);
    await expect(copyDirectoryContents(source, target)).rejects.toThrow("ENOENT");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "data.txt"), "source");
    await fs.writeFile(path.join(target, "data.txt"), "existing");
    await expect(copyDirectoryContents(source, target)).rejects.toThrow("EEXIST");
    expect(await fs.readFile(path.join(target, "data.txt"), "utf8")).toBe("existing");
  });

  it("keeps parent filesystem and DNS responsive when all child I/O threads block, then kills the timed-out child", async () => {
    const root = await makeTempDir();
    const fifo = path.join(root, "blocked-io");
    await promisify(actualChildProcess.execFile)("mkfifo", [fifo]);
    let child: ChildProcess | undefined;
    let childReady!: () => void;
    const ready = new Promise<void>((resolve) => { childReady = resolve; });
    vi.mocked(execFile).mockImplementationOnce(((file, args, options, callback) => {
      const blockedScript = `
        import { open } from "node:fs/promises";
        for (let i = 0; i < 4; i++) void open(${JSON.stringify(fifo)}, "r");
        process.stdout.write("ready");
      `;
      const nextArgs = [...args];
      nextArgs[2] = blockedScript + nextArgs[2];
      child = actualChildProcess.execFile(file, nextArgs, {
        ...options,
        env: { ...process.env, UV_THREADPOOL_SIZE: "4" },
        timeout: 1500
      }, callback);
      child.stdout!.once("data", childReady);
      return child;
    }) as typeof execFile);

    const operation = resetManagedStorageRoot(path.join(root, "target"));
    const rejected = expect(operation).rejects.toThrow("filesystem operation limit");
    try {
      await ready;
      await Promise.all([lookup("localhost"), fs.writeFile(path.join(root, "parent.txt"), "responsive")]);
      expect(child!.exitCode).toBeNull();
      expect(child!.signalCode).toBeNull();
      expect(await fs.readFile(path.join(root, "parent.txt"), "utf8")).toBe("responsive");
      await rejected;
      expect(child!.signalCode).toBe("SIGKILL");
    } finally {
      child?.kill("SIGKILL");
      await operation.catch(() => undefined);
    }
  });
});

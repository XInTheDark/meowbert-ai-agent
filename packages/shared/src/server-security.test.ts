import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDirectoryWithinRoot,
  openReadablePathWithinRoots,
  resolveReadablePathWithinRoots
} from "./server-security.js";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-server-security-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (rootPath) => {
    await fs.rm(rootPath, { recursive: true, force: true });
  }));
});

describe("resolveReadablePathWithinRoots", () => {
  it("preserves missing-file errors for paths inside an allowed root", async () => {
    const root = await createTempRoot();
    await expect(openReadablePathWithinRoots([root], path.join(root, "missing.jpg")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resolves relative paths against later readable roots when they are missing from earlier ones", async () => {
    const rootPath = await createTempRoot();
    const taskDir = path.join(rootPath, ".meowbert", "task-runs", "task-1");
    const envRoot = path.join(rootPath, "project");
    const contextFilePath = path.join(envRoot, "context", "context-notes.txt");

    await fs.mkdir(taskDir, { recursive: true });
    await fs.mkdir(path.dirname(contextFilePath), { recursive: true });
    await fs.writeFile(contextFilePath, "notes");

    const resolved = await resolveReadablePathWithinRoots(
      [taskDir, envRoot],
      "context/context-notes.txt"
    );

    expect(resolved).toBe(await fs.realpath(contextFilePath));
  });

  it("still resolves absolute paths inside allowed roots", async () => {
    const rootPath = await createTempRoot();
    const envRoot = path.join(rootPath, "project");
    const filePath = path.join(envRoot, "context", "guide.md");

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "guide");

    const resolved = await resolveReadablePathWithinRoots([envRoot], filePath);

    expect(resolved).toBe(await fs.realpath(filePath));
  });

  it("rejects files outside the allowed roots", async () => {
    const rootPath = await createTempRoot();
    const envRoot = path.join(rootPath, "project");
    const outsideFilePath = path.join(rootPath, "outside.txt");

    await fs.mkdir(envRoot, { recursive: true });
    await fs.writeFile(outsideFilePath, "nope");

    await expect(resolveReadablePathWithinRoots([envRoot], outsideFilePath)).rejects.toThrow(
      "Read operation denied outside allowed roots"
    );
  });

  it("rejects an in-root symlink whose real target is outside the root", async () => {
    const rootPath = await createTempRoot();
    const envRoot = path.join(rootPath, "project");
    const outsideFilePath = path.join(rootPath, "outside.txt");
    const linkedFilePath = path.join(envRoot, "linked.txt");

    await fs.mkdir(envRoot, { recursive: true });
    await fs.writeFile(outsideFilePath, "secret");
    await fs.symlink(outsideFilePath, linkedFilePath);

    await expect(resolveReadablePathWithinRoots([envRoot], linkedFilePath)).rejects.toThrow(
      "Read operation denied outside allowed roots"
    );
  });

  it("supports a configured root that is itself a symlink", async () => {
    const rootPath = await createTempRoot();
    const realRoot = path.join(rootPath, "real-project");
    const linkedRoot = path.join(rootPath, "linked-project");
    const filePath = path.join(realRoot, "guide.md");

    await fs.mkdir(realRoot, { recursive: true });
    await fs.writeFile(filePath, "guide");
    await fs.symlink(realRoot, linkedRoot);

    await expect(resolveReadablePathWithinRoots([linkedRoot], filePath)).resolves.toBe(await fs.realpath(filePath));
  });

  it("returns an open handle for a regular file inside an allowed root", async () => {
    const rootPath = await createTempRoot();
    const envRoot = path.join(rootPath, "project");
    const filePath = path.join(envRoot, "guide.md");

    await fs.mkdir(envRoot, { recursive: true });
    await fs.writeFile(filePath, "guide");

    const opened = await openReadablePathWithinRoots([envRoot], filePath);
    try {
      await expect(opened.fileHandle.readFile("utf8")).resolves.toBe("guide");
      expect(opened.realPath).toBe(await fs.realpath(filePath));
    } finally {
      await opened.fileHandle.close();
    }
  });
});

describe("ensureDirectoryWithinRoot", () => {
  it("allows concurrent creation of the same nested directory", async () => {
    const rootPath = await createTempRoot();
    const requestedPath = ".meowbert/task-runs/task-1/inputs";

    const resolved = await Promise.all(Array.from({ length: 8 }, () => ensureDirectoryWithinRoot({
      rootPath,
      requestedPath,
      createDirectories: true
    })));

    const expectedPath = path.join(rootPath, ".meowbert", "task-runs", "task-1", "inputs");
    expect((await fs.stat(expectedPath)).isDirectory()).toBe(true);
    expect(resolved.map((entry) => entry.relativePath)).toEqual(
      Array.from({ length: 8 }, () => ".meowbert/task-runs/task-1/inputs")
    );
  });
});

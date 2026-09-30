import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./linux-safe-fs.js", async () => {
  const { default: mockedFsPromises } = await import("node:fs/promises");
  const { default: mockedPath } = await import("node:path");
  return {
    snapshotLiveSyncPath: async (input: {
      environmentRootPath: string;
      localRelativePath: string;
      stagedPath: string;
    }) => {
      await mockedFsPromises.cp(
        mockedPath.join(input.environmentRootPath, input.localRelativePath),
        input.stagedPath,
        { recursive: true }
      );
    }
  };
});
import {
  readSourceFileLinkLocalSnapshot,
  resolveSourceFileLinkAbsolutePath,
  stageSourceFileLinkUpload
} from "./local-file-state.js";

const temporaryDirectories: string[] = [];

async function createEnvironmentRoot(): Promise<string> {
  const rootPath = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-live-sync-test-"));
  temporaryDirectories.push(rootPath);
  return rootPath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fsPromises.rm(directory, { recursive: true, force: true })));
});

describe("local source file link state", () => {
  it("reads and stages a regular in-root file", async () => {
    const rootPath = await createEnvironmentRoot();
    await fsPromises.writeFile(path.join(rootPath, "notes.txt"), "private notes");

    const snapshot = await readSourceFileLinkLocalSnapshot({
      environmentRootPath: rootPath,
      localRelativePath: "notes.txt",
      includeHash: true
    });
    const staged = await stageSourceFileLinkUpload({
      environmentRootPath: rootPath,
      localRelativePath: "notes.txt"
    });

    expect(snapshot).toMatchObject({ exists: true, kind: "file", sizeBytes: 13 });
    await expect(fsPromises.readFile(staged.localFilePath, "utf8")).resolves.toBe("private notes");
    await staged.cleanup();
  });

  it("rejects a final symlink even when its lexical path is inside the environment", async () => {
    const rootPath = await createEnvironmentRoot();
    const outsidePath = path.join(rootPath, "..", `outside-${path.basename(rootPath)}.txt`);
    await fsPromises.writeFile(outsidePath, "outside");
    await fsPromises.symlink(outsidePath, path.join(rootPath, "linked.txt"));

    await expect(resolveSourceFileLinkAbsolutePath({
      environmentRootPath: rootPath,
      localRelativePath: "linked.txt"
    })).rejects.toThrow("symbolic links");
  });

  it("rejects a symlinked parent directory", async () => {
    const rootPath = await createEnvironmentRoot();
    const outsideDirectory = path.join(rootPath, "..", `outside-directory-${path.basename(rootPath)}`);
    await fsPromises.mkdir(outsideDirectory);
    await fsPromises.writeFile(path.join(outsideDirectory, "secret.txt"), "outside");
    await fsPromises.symlink(outsideDirectory, path.join(rootPath, "linked-directory"));

    await expect(readSourceFileLinkLocalSnapshot({
      environmentRootPath: rootPath,
      localRelativePath: "linked-directory/secret.txt"
    })).rejects.toThrow("symbolic links");
  });

  it("rejects a symlink anywhere in a linked folder", async () => {
    const rootPath = await createEnvironmentRoot();
    await fsPromises.mkdir(path.join(rootPath, "folder"));
    await fsPromises.writeFile(path.join(rootPath, "outside.txt"), "outside");
    await fsPromises.symlink(path.join(rootPath, "outside.txt"), path.join(rootPath, "folder", "linked.txt"));

    await expect(readSourceFileLinkLocalSnapshot({
      environmentRootPath: rootPath,
      localRelativePath: "folder",
      includeHash: true
    })).rejects.toThrow("symbolic links");
  });
});

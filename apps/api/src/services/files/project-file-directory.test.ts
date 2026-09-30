import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveProjectFileDirectory } from "./project-file-directory.js";

const tempRoots: string[] = [];

async function createRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-project-context-"));
  tempRoots.push(rootPath);
  return rootPath;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (rootPath) => {
    await fs.rm(rootPath, { recursive: true, force: true });
  }));
});

describe("resolveProjectFileDirectory", () => {
  it("creates the project context root on demand", async () => {
    const rootPath = await createRoot();

    const resolved = await resolveProjectFileDirectory(rootPath, "context");

    await expect(fs.stat(path.join(rootPath, "context"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    expect(resolved.relativePath).toBe("context");
  });

  it("creates nested project context directories on demand", async () => {
    const rootPath = await createRoot();

    const resolved = await resolveProjectFileDirectory(rootPath, "context/specs");

    await expect(fs.stat(path.join(rootPath, "context", "specs"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    expect(resolved.relativePath).toBe("context/specs");
  });

  it("still rejects missing non-context directories", async () => {
    const rootPath = await createRoot();

    await expect(resolveProjectFileDirectory(rootPath, "docs")).rejects.toThrow(/no such file or directory/i);
  });
});

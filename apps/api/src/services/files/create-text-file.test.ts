import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTextFileWithinRoot } from "./create-text-file.js";

const tempRoots: string[] = [];

async function createRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-create-text-file-"));
  tempRoots.push(rootPath);
  return rootPath;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (rootPath) => {
    await fs.rm(rootPath, { recursive: true, force: true });
  }));
});

describe("createTextFileWithinRoot", () => {
  it("writes the provided text content into the requested directory", async () => {
    const rootPath = await createRoot();

    const created = await createTextFileWithinRoot({
      rootPath,
      requestedDirectoryPath: "context",
      name: "context-notes.txt",
      content: "hello context"
    });

    expect(created.relativePath).toBe("context/context-notes.txt");
    await expect(fs.readFile(path.join(rootPath, "context", "context-notes.txt"), "utf8")).resolves.toBe("hello context");
  });

  it("creates a deduplicated filename when one already exists", async () => {
    const rootPath = await createRoot();
    await fs.mkdir(path.join(rootPath, "context"), { recursive: true });
    await fs.writeFile(path.join(rootPath, "context", "notes.txt"), "first", "utf8");

    const created = await createTextFileWithinRoot({
      rootPath,
      requestedDirectoryPath: "context",
      name: "notes.txt",
      content: "second"
    });

    expect(created.relativePath).toBe("context/notes (1).txt");
    await expect(fs.readFile(path.join(rootPath, "context", "notes (1).txt"), "utf8")).resolves.toBe("second");
  });
});

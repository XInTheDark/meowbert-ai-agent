import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listDirectorySizeEntries } from "./file-browser-metadata.js";

function writeFile(root: string, relativePath: string, size: number): void {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, Buffer.alloc(size, "a"));
}

describe("file browser metadata", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it("returns recursive sizes for immediate child directories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-file-browser-meta-"));
    tempDirs.push(root);

    writeFile(root, "docs/readme.md", 10);
    writeFile(root, "docs/nested/spec.md", 6);
    writeFile(root, "logs/app.log", 8);
    writeFile(root, "loose.txt", 4);

    const result = await listDirectorySizeEntries({ rootPath: root });

    expect(result).toEqual({
      cwd: "",
      items: [
        { relativePath: "docs", sizeBytes: 16 },
        { relativePath: "logs", sizeBytes: 8 }
      ]
    });
  });

  it("supports nested folder requests and skips symlinks inside size calculations", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-file-browser-meta-"));
    tempDirs.push(root);

    writeFile(root, "workspace/src/index.ts", 12);
    writeFile(root, "workspace/src/lib/util.ts", 5);
    writeFile(root, "workspace/tests/app.test.ts", 9);
    fs.symlinkSync(path.join(root, "workspace", "src", "index.ts"), path.join(root, "workspace", "tests", "index-link.ts"));

    const result = await listDirectorySizeEntries({
      rootPath: root,
      requestedPath: "workspace"
    });

    expect(result).toEqual({
      cwd: "workspace",
      items: [
        { relativePath: "workspace/src", sizeBytes: 17 },
        { relativePath: "workspace/tests", sizeBytes: 9 }
      ]
    });
  });
});

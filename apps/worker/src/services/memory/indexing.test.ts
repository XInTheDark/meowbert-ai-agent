import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config.js", () => ({
  config: { memory: { indexCacheRoot: "/tmp/meowbert-memory-index-tests" } }
}));

import { scanMemoryFiles } from "./indexing.js";

let memoryDir: string;
const relativePath = ".memory/notes.md";

beforeEach(async () => {
  memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-scan-"));
  await fs.writeFile(path.join(memoryDir, "notes.md"), "current notes");
});

afterEach(async () => {
  await fs.rm(memoryDir, { recursive: true, force: true });
});

async function recordFor(hashedAfterWriteMs: number) {
  const stats = await fs.stat(path.join(memoryDir, "notes.md"));
  return {
    [relativePath]: {
      sha256: "recorded-hash",
      sizeBytes: stats.size,
      modifiedAtMs: stats.mtimeMs,
      hashedAtMs: stats.mtimeMs + hashedAfterWriteMs
    }
  };
}

describe("scanMemoryFiles", () => {
  it("reuses the recorded hash of a file whose size and mtime are unchanged", async () => {
    const [file] = await scanMemoryFiles(memoryDir, await recordFor(60_000));
    expect(file).toMatchObject({ relativePath, sha256: "recorded-hash" });
  });

  it("hashes again when the recorded hash was taken right after a write", async () => {
    const [file] = await scanMemoryFiles(memoryDir, await recordFor(500));
    expect(file.sha256).toBe(createHash("sha256").update("current notes").digest("hex"));
  });

  it("hashes again when the file's mtime moved", async () => {
    const previous = await recordFor(60_000);
    previous[relativePath].modifiedAtMs -= 1_000;
    const [file] = await scanMemoryFiles(memoryDir, previous);
    expect(file.sha256).toBe(createHash("sha256").update("current notes").digest("hex"));
  });
});

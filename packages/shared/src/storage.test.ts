import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStorageUsageSummary,
  calculatePathUsageBytes,
  calculatePathsUsageBytes
} from "./storage.js";

function writeFile(root: string, relativePath: string, size: number): void {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, Buffer.alloc(size, "a"));
}

describe("storage helpers", () => {
  it("counts file usage recursively and skips symlinks", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-storage-"));
    writeFile(root, "alpha.txt", 10);
    writeFile(root, "nested/beta.txt", 5);
    fs.symlinkSync(path.join(root, "alpha.txt"), path.join(root, "nested", "alpha-link.txt"));

    await expect(calculatePathUsageBytes(root)).resolves.toBe(15);
  });

  it("deduplicates hard-linked files across multiple roots", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-storage-multi-"));
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    const filePath = path.join(first, "payload.bin");
    fs.writeFileSync(filePath, Buffer.alloc(12, "b"));
    fs.linkSync(filePath, path.join(second, "payload.bin"));

    await expect(calculatePathsUsageBytes([first, second])).resolves.toBe(12);
  });

  it("builds storage summaries with limit metadata", () => {
    expect(buildStorageUsageSummary({ usedBytes: 90, limitBytes: 100 })).toEqual({
      usedBytes: 90,
      limitBytes: 100,
      availableBytes: 10,
      usagePercent: 90,
      isOverLimit: false
    });

    expect(buildStorageUsageSummary({ usedBytes: 110, limitBytes: 100 })).toMatchObject({
      usagePercent: 100,
      availableBytes: 0,
      isOverLimit: true
    });
  });
});

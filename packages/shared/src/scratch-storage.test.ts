import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readScratchStorage } from "./scratch-storage.js";

describe("scratch storage capacity", () => {
  it("caps the effective budget at the actual filesystem and measures without traversing files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scratch-capacity-"));
    try {
      const native = await fs.statfs(root);
      const status = await readScratchStorage(root, Number.MAX_SAFE_INTEGER);
      expect(status.capacityBytes).toBe(native.bsize * native.blocks);
      expect(status.effectiveLimitBytes).toBe(status.capacityBytes);
      expect((await readScratchStorage(root, 1)).effectiveLimitBytes).toBe(1024 * 1024);
      expect((await readScratchStorage(root, null)).effectiveLimitBytes).toBe(status.capacityBytes);
    } finally { await fs.rm(root, { recursive: true }); }
  });
});

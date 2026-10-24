import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveMountedStoragePath } from "./roots";

describe("desktop storage roots", () => {
  it("keeps executor paths inside the selected mount", () => {
    const root = path.join(path.sep, "Users", "meowbert", "workspace");
    expect(resolveMountedStoragePath(root, "projects/demo")).toBe(path.join(root, "projects/demo"));
    expect(() => resolveMountedStoragePath(root, "../../secrets")).toThrow(/escapes/);
  });
});


it("refuses symlinks that lead outside the mount and missing relative mappings", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const { resolveVerifiedStoragePath } = await import("./roots");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-root-test-"));
  try {
    await fs.mkdir(path.join(temp, "root"));
    await fs.mkdir(path.join(temp, "outside"));
    await fs.symlink(path.join(temp, "outside"), path.join(temp, "root", "escape"));
    await expect(resolveVerifiedStoragePath(path.join(temp, "root"), "escape")).rejects.toThrow(/symlink escapes/);
    await expect(resolveVerifiedStoragePath(path.join(temp, "root"), undefined)).rejects.toThrow(/storage-relative/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

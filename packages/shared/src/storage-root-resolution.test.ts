import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalizeStorageRoot, resolveCanonicalStorageRoot } from "./storage-root-resolution.js";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-storage-root-resolution-"));
  tempRoots.push(rootPath);
  return rootPath;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (rootPath) => {
    await fs.rm(rootPath, { recursive: true, force: true });
  }));
});

describe("canonicalizeStorageRoot", () => {
  it("creates and canonicalizes symlinked paths", async () => {
    const tempRoot = await createTempRoot();
    const actualRoot = path.join(tempRoot, "actual-root");
    const symlinkRoot = path.join(tempRoot, "root-link");

    await fs.mkdir(actualRoot, { recursive: true });
    await fs.symlink(actualRoot, symlinkRoot);

    await expect(canonicalizeStorageRoot(symlinkRoot)).resolves.toBe(await fs.realpath(actualRoot));
  });
});

describe("resolveCanonicalStorageRoot", () => {
  it("uses and persists the canonical managed root when no configured root is set", async () => {
    const tempRoot = await createTempRoot();
    const managedActualRoot = path.join(tempRoot, "managed-actual-root");
    const managedSymlinkRoot = path.join(tempRoot, "managed-root-link");
    const persistRoot = vi.fn(async () => {});

    await fs.mkdir(managedActualRoot, { recursive: true });
    await fs.symlink(managedActualRoot, managedSymlinkRoot);

    const resolved = await resolveCanonicalStorageRoot({
      configuredRoot: "",
      managedRoot: managedSymlinkRoot,
      persistRoot
    });

    expect(resolved).toBe(await fs.realpath(managedActualRoot));
    expect(persistRoot).toHaveBeenCalledWith(await fs.realpath(managedActualRoot));
  });

  it("uses and persists the canonical configured root when a symlinked root is provided", async () => {
    const tempRoot = await createTempRoot();
    const configuredActualRoot = path.join(tempRoot, "configured-actual-root");
    const configuredSymlinkRoot = path.join(tempRoot, "configured-root-link");
    const persistRoot = vi.fn(async () => {});

    await fs.mkdir(configuredActualRoot, { recursive: true });
    await fs.symlink(configuredActualRoot, configuredSymlinkRoot);

    const resolved = await resolveCanonicalStorageRoot({
      configuredRoot: configuredSymlinkRoot,
      managedRoot: path.join(tempRoot, "managed-root"),
      persistRoot
    });

    expect(resolved).toBe(await fs.realpath(configuredActualRoot));
    expect(persistRoot).toHaveBeenCalledWith(await fs.realpath(configuredActualRoot));
  });
});

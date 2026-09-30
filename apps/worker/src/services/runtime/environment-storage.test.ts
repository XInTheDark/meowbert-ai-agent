import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../storage/backend-registry.js", () => ({
  storageBackendRegistry: {
    ensureBackendReady: vi.fn(async () => {}),
    resolveManagedEnvironmentRoot: vi.fn(() => "/tmp/managed-env-root"),
    getConfiguredDefaultBackendId: vi.fn(() => "backend-1")
  }
}));

import { query } from "../../lib/db.js";
import { storageBackendRegistry } from "../storage/backend-registry.js";
import { resolveTaskEnvironmentRoot } from "./environment-storage.js";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-worker-env-root-"));
  tempRoots.push(rootPath);
  return rootPath;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (rootPath) => {
    await fs.rm(rootPath, { recursive: true, force: true });
  }));
});

describe("resolveTaskEnvironmentRoot", () => {
  const mockedQuery = vi.mocked(query);
  const mockedStorageBackendRegistry = vi.mocked(storageBackendRegistry);

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedStorageBackendRegistry.ensureBackendReady.mockReset();
    mockedStorageBackendRegistry.resolveManagedEnvironmentRoot.mockReset();
    mockedStorageBackendRegistry.getConfiguredDefaultBackendId.mockReset();
    mockedStorageBackendRegistry.resolveManagedEnvironmentRoot.mockReturnValue("/tmp/managed-env-root");
    mockedStorageBackendRegistry.getConfiguredDefaultBackendId.mockReturnValue("backend-1");
  });

  it("canonicalizes symlinked environment roots before returning and persisting them", async () => {
    const tempRoot = await createTempRoot();
    const actualRoot = path.join(tempRoot, "actual-env-root");
    const symlinkRoot = path.join(tempRoot, "env-root-link");

    await fs.mkdir(actualRoot, { recursive: true });
    await fs.symlink(actualRoot, symlinkRoot);

    const resolved = await resolveTaskEnvironmentRoot({
      workspaceId: "ws-1",
      environmentId: "env-1",
      rootPath: symlinkRoot,
      storageBackendId: "backend-1"
    });

    expect(resolved).toBe(await fs.realpath(actualRoot));
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE environments"),
      ["env-1", await fs.realpath(actualRoot)]
    );
  });

  it("canonicalizes managed environment roots when no explicit root path is configured", async () => {
    const tempRoot = await createTempRoot();
    const managedActualRoot = path.join(tempRoot, "managed-actual-env-root");
    const managedSymlinkRoot = path.join(tempRoot, "managed-env-root-link");

    await fs.mkdir(managedActualRoot, { recursive: true });
    await fs.symlink(managedActualRoot, managedSymlinkRoot);
    mockedStorageBackendRegistry.resolveManagedEnvironmentRoot.mockReturnValue(managedSymlinkRoot);

    const resolved = await resolveTaskEnvironmentRoot({
      workspaceId: "ws-1",
      environmentId: "env-2",
      rootPath: "",
      storageBackendId: "backend-1"
    });

    expect(resolved).toBe(await fs.realpath(managedActualRoot));
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE environments"),
      ["env-2", await fs.realpath(managedActualRoot)]
    );
  });
});

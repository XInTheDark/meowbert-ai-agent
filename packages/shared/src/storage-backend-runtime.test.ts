import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StorageBackendRuntimeRegistry, type StorageBackendCommandRunner } from "./storage-backend-runtime.js";
import { normalizeStorageConfig } from "./storage-backends.js";

function createTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-storage-runtime-"));
}

function createStorageConfig(tempRoot: string) {
  return normalizeStorageConfig({
    baseDir: tempRoot,
    workspacesRoot: path.join(tempRoot, "runtime/workspaces"),
    environmentsRoot: path.join(tempRoot, "runtime/environments"),
    rawStorage: {
      defaultWorkspaceBackendId: "mounted-main",
      backends: [
        {
          id: "mounted-main",
          type: "mounted",
          mountPath: "./runtime/storage/mounted-main",
          workspacesDir: "workspaces",
          environmentsDir: "environments"
        }
      ]
    }
  });
}

function createMountedCommandRunner(input: { mounted?: boolean } = {}): StorageBackendCommandRunner {
  const mounted = input.mounted ?? true;
  return {
    async execFile(command) {
      if (command !== "mountpoint") {
        throw new Error(`Unexpected command: ${command}`);
      }
      if (mounted) {
        return { stdout: "", stderr: "" };
      }
      throw new Error("not mounted");
    }
  };
}

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("StorageBackendRuntimeRegistry", () => {
  it("creates local backend roots when asked to ensure readiness", async () => {
    const tempRoot = createTempRoot();
    tempRoots.push(tempRoot);
    const storage = normalizeStorageConfig({
      baseDir: tempRoot,
      workspacesRoot: path.join(tempRoot, "runtime/workspaces"),
      environmentsRoot: path.join(tempRoot, "runtime/environments")
    });
    const registry = new StorageBackendRuntimeRegistry(storage);

    await registry.ensureBackendReady("local-default");

    expect(fs.existsSync(path.join(tempRoot, "runtime/workspaces"))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, "runtime/environments"))).toBe(true);
  });

  it("ensures the managed workspaces directory inside an active mounted backend", async () => {
    const tempRoot = createTempRoot();
    tempRoots.push(tempRoot);
    const storage = createStorageConfig(tempRoot);
    const mountPath = path.join(tempRoot, "runtime/storage/mounted-main");
    fs.mkdirSync(mountPath, { recursive: true });
    const registry = new StorageBackendRuntimeRegistry(storage, {
      commandRunner: createMountedCommandRunner({ mounted: true })
    });

    await registry.ensureBackendReady("mounted-main");

    expect(fs.existsSync(path.join(mountPath, "workspaces"))).toBe(true);
  });

  it("reports an error when the mounted backend path does not exist", async () => {
    const tempRoot = createTempRoot();
    tempRoots.push(tempRoot);
    const storage = createStorageConfig(tempRoot);
    const registry = new StorageBackendRuntimeRegistry(storage, {
      commandRunner: createMountedCommandRunner({ mounted: true })
    });

    const health = await registry.getBackendHealth("mounted-main", { ensureMounted: true });

    expect(health.state).toBe("error");
    expect(health.message).toContain("Mounted storage backend path does not exist");
  });

  it("reports an error when the mounted backend path exists but is not active", async () => {
    const tempRoot = createTempRoot();
    tempRoots.push(tempRoot);
    const storage = createStorageConfig(tempRoot);
    const mountPath = path.join(tempRoot, "runtime/storage/mounted-main");
    fs.mkdirSync(mountPath, { recursive: true });
    const registry = new StorageBackendRuntimeRegistry(storage, {
      commandRunner: createMountedCommandRunner({ mounted: false })
    });

    const health = await registry.getBackendHealth("mounted-main", { ensureMounted: true });

    expect(health.state).toBe("error");
    expect(health.message).toContain(`not an active mountpoint inside the API/worker container: ${mountPath}`);
    expect(health.message).toContain("runtime bind mount uses shared propagation");
  });
});

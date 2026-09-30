import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEGACY_LOCAL_STORAGE_BACKEND_ID,
  normalizeStorageConfig,
  resolveEnvironmentStorageRootForBackend,
  resolveWorkspaceStorageRootForBackend
} from "./storage-backends.js";

describe("normalizeStorageConfig", () => {
  it("synthesizes the legacy local-default backend from runtime roots", () => {
    const storage = normalizeStorageConfig({
      baseDir: "/repo",
      workspacesRoot: "/runtime/workspaces",
      environmentsRoot: "/runtime/environments"
    });

    expect(storage.defaultWorkspaceBackendId).toBe(LEGACY_LOCAL_STORAGE_BACKEND_ID);
    expect(storage.backends).toEqual([
      {
        id: LEGACY_LOCAL_STORAGE_BACKEND_ID,
        label: "Local (legacy)",
        type: "local",
        workspacesRoot: "/runtime/workspaces",
        environmentsRoot: "/runtime/environments"
      }
    ]);
  });

  it("normalizes relative backend paths while preserving the configured default", () => {
    const storage = normalizeStorageConfig({
      baseDir: "/repo",
      workspacesRoot: "/runtime/workspaces",
      environmentsRoot: "/runtime/environments",
      rawStorage: {
        defaultWorkspaceBackendId: "mounted-main",
        backends: [
          {
            id: "local-default",
            type: "local",
            workspacesRoot: "./runtime/workspaces",
            environmentsRoot: "./runtime/environments",
            xfsProjectQuota: {
              mountPath: "./runtime/workspaces",
              projectIdBase: 20_000
            }
          },
          {
            id: "mounted-main",
            type: "mounted",
            mountPath: "./runtime/storage/mounted-main",
            workspacesDir: "mount-workspaces",
            environmentsDir: "mount-environments"
          }
        ]
      }
    });

    expect(storage.defaultWorkspaceBackendId).toBe("mounted-main");
    expect(storage.backends.map((backend) => backend.id)).toEqual([
      LEGACY_LOCAL_STORAGE_BACKEND_ID,
      "mounted-main"
    ]);

    const localBackend = storage.backends.find((backend) => backend.id === LEGACY_LOCAL_STORAGE_BACKEND_ID);
    const mountedBackend = storage.backends.find((backend) => backend.id === "mounted-main");

    expect(localBackend).toMatchObject({
      type: "local",
      workspacesRoot: path.resolve("/repo", "runtime/workspaces"),
      environmentsRoot: path.resolve("/repo", "runtime/environments"),
      xfsProjectQuota: {
        mountPath: path.resolve("/repo", "runtime/workspaces"),
        projectIdBase: 20_000
      }
    });
    expect(mountedBackend).toMatchObject({
      type: "mounted",
      mountPath: path.resolve("/repo", "runtime/storage/mounted-main"),
      workspacesDir: "mount-workspaces",
      environmentsDir: "mount-environments"
    });
  });

  it("rejects a configured default backend id that does not exist", () => {
    expect(() =>
      normalizeStorageConfig({
        baseDir: "/repo",
        workspacesRoot: "/runtime/workspaces",
        environmentsRoot: "/runtime/environments",
        rawStorage: {
          defaultWorkspaceBackendId: "missing",
          backends: [
            {
              id: "mounted-main",
              type: "mounted",
              mountPath: "./runtime/storage/mounted-main"
            }
          ]
        }
      })
    ).toThrow("Configured default storage backend not found: missing");
  });
});

describe("storage backend root resolution", () => {
  it("resolves environment roots inside the workspace storage unit", () => {
    const storage = normalizeStorageConfig({
      baseDir: "/repo",
      workspacesRoot: "/runtime/workspaces",
      environmentsRoot: "/runtime/environments",
      rawStorage: {
        defaultWorkspaceBackendId: "mounted-main",
        backends: [
          {
            id: "mounted-main",
            type: "mounted",
            mountPath: "./runtime/storage/mounted-main",
            workspacesDir: "mount-workspaces",
            environmentsDir: "mount-environments"
          }
        ]
      }
    });

    const backend = storage.backends.find((entry) => entry.id === "mounted-main");
    expect(backend).toBeTruthy();

    expect(resolveWorkspaceStorageRootForBackend(backend!, "ws-1")).toBe(
      path.resolve("/repo", "runtime/storage/mounted-main", "mount-workspaces", "ws-1", "root")
    );
    expect(resolveEnvironmentStorageRootForBackend(backend!, "ws-1", "env-1")).toBe(
      path.resolve("/repo", "runtime/storage/mounted-main", "mount-workspaces", "ws-1", "mount-environments", "env-1", "root")
    );
  });
});

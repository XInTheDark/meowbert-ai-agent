import { describe, expect, it, vi } from "vitest";
import { warmStorageBackendsOnStartup } from "./storage-backend-startup.js";

describe("warmStorageBackendsOnStartup", () => {
  it("warms only externally mounted backends by default", async () => {
    const ensureBackendReady = vi.fn(async () => undefined);

    await warmStorageBackendsOnStartup(
      {
        listBackends: () => [
          {
            id: "local-default",
            type: "local",
            workspacesRoot: "/runtime/workspaces",
            environmentsRoot: "/runtime/environments"
          },
          {
            id: "mounted-main",
            type: "mounted",
            mountPath: "/runtime/storage/mounted-main"
          }
        ],
        ensureBackendReady
      }
    );

    expect(ensureBackendReady).toHaveBeenCalledTimes(1);
    expect(ensureBackendReady).toHaveBeenCalledWith("mounted-main");
  });

  it("logs failures and continues warming the remaining backends", async () => {
    const ensureBackendReady = vi.fn(async (backendId: string) => {
      if (backendId === "mounted-main") {
        throw new Error("mount is not active");
      }
    });
    const logger = {
      info: vi.fn(),
      error: vi.fn()
    };

    await warmStorageBackendsOnStartup(
      {
        listBackends: () => [
          {
            id: "mounted-main",
            type: "mounted",
            mountPath: "/runtime/storage/mounted-main"
          },
          {
            id: "mounted-backup",
            type: "mounted",
            mountPath: "/runtime/storage/mounted-backup"
          }
        ],
        ensureBackendReady
      },
      { logger }
    );

    expect(ensureBackendReady).toHaveBeenNthCalledWith(1, "mounted-main");
    expect(ensureBackendReady).toHaveBeenNthCalledWith(2, "mounted-backup");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Startup storage check failed for mounted backend mounted-main: mount is not active")
    );
    expect(logger.info).toHaveBeenCalledWith(
      "[storage] Startup storage ready for mounted backend mounted-backup"
    );
  });
});

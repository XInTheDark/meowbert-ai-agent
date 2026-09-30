import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../lib/api";
import { loadLastWorkspaceId, saveLastWorkspaceId } from "./utils";
import { shouldLogoutForWorkspaceBootstrapError, upsertEnvironment } from "./useWorkspaceLayoutController";

describe("upsertEnvironment", () => {
  it("inserts a newly created environment at the top using its fresh timestamp", () => {
    const environments = [
      {
        id: "env_existing",
        workspace_id: "ws_1",
        name: "Existing",
        status: "active" as const,
        created_at: "2026-03-29T00:00:00.000Z",
        updated_at: "2026-03-29T00:00:00.000Z"
      }
    ];

    const next = upsertEnvironment(environments, {
      id: "env_new",
      workspace_id: "ws_1",
      name: "New environment",
      status: "active",
      created_at: "2026-03-30T00:00:00.000Z",
      updated_at: "2026-03-30T00:00:00.000Z"
    });

    expect(next.map((environment) => environment.id)).toEqual(["env_new", "env_existing"]);
  });

  it("replaces an existing environment instead of duplicating it", () => {
    const next = upsertEnvironment(
      [
        {
          id: "env_1",
          workspace_id: "ws_1",
          name: "Old name",
          status: "active" as const,
          created_at: "2026-03-29T00:00:00.000Z",
          updated_at: "2026-03-29T00:00:00.000Z"
        }
      ],
      {
        id: "env_1",
        workspace_id: "ws_1",
        name: "Renamed",
        status: "active",
        created_at: "2026-03-29T00:00:00.000Z",
        updated_at: "2026-03-30T00:00:00.000Z"
      }
    );

    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("Renamed");
  });
});

describe("shouldLogoutForWorkspaceBootstrapError", () => {
  it("logs the user out only for unauthorized bootstrap failures", () => {
    expect(shouldLogoutForWorkspaceBootstrapError(new ApiError("Unauthorized", 401, { error: "Unauthorized" }))).toBe(true);
    expect(shouldLogoutForWorkspaceBootstrapError(new ApiError("Internal server error", 500, { error: "Internal server error" }))).toBe(false);
    expect(shouldLogoutForWorkspaceBootstrapError(new Error("Network down"))).toBe(false);
  });
});

describe("last workspace fallback", () => {
  it("persists an explicitly selected workspace only as a fallback for /app", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      clear: () => storage.clear()
    });

    expect(loadLastWorkspaceId()).toBeNull();
    saveLastWorkspaceId("ws_selected");

    expect(loadLastWorkspaceId()).toBe("ws_selected");
  });
});

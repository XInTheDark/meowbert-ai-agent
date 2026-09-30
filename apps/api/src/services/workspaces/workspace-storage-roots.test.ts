import { describe, expect, it } from "vitest";
import { dedupeNestedWorkspaceStorageRoots } from "./workspace-storage-roots.js";

describe("dedupeNestedWorkspaceStorageRoots", () => {
  it("drops nested environment roots that are already covered by the workspace root", () => {
    expect(dedupeNestedWorkspaceStorageRoots([
      "/runtime/workspaces/ws-1/root",
      "/runtime/workspaces/ws-1/root/environments/env-1/root",
      "/runtime/workspaces/ws-1/root/environments/env-2/root"
    ])).toEqual([
      "/runtime/workspaces/ws-1/root"
    ]);
  });

  it("keeps distinct roots when they are not nested", () => {
    expect(dedupeNestedWorkspaceStorageRoots([
      "/runtime/workspaces/ws-1/root",
      "/runtime/legacy-environments/env-1/root"
    ])).toEqual([
      "/runtime/workspaces/ws-1/root",
      "/runtime/legacy-environments/env-1/root"
    ]);
  });
});

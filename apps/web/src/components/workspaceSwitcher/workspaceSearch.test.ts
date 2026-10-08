import { describe, expect, it } from "vitest";
import type { Workspace } from "../../lib/types";
import { filterWorkspaces, sortWorkspaceOptions } from "./workspaceSearch";

const workspaces: Workspace[] = [
  { id: "ws_b", name: "Billing", role: "member" },
  { id: "ws_a", name: "Alpha", role: "owner" },
  { id: "ws_ops", name: "Operations", role: "member" }
];

describe("workspace switcher search", () => {
  it("pins the active workspace and keeps the rest in recency order", () => {
    expect(sortWorkspaceOptions(workspaces, "ws_ops").map((workspace) => workspace.id)).toEqual([
      "ws_ops",
      "ws_b",
      "ws_a"
    ]);
  });

  it("filters by name and role", () => {
    expect(filterWorkspaces(workspaces, "bill").map((workspace) => workspace.id)).toEqual(["ws_b"]);
    expect(filterWorkspaces(workspaces, "owner").map((workspace) => workspace.id)).toEqual(["ws_a"]);
  });
});

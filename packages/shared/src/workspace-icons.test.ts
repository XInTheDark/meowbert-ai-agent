import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_ICON_KEY, normalizeWorkspaceIconKey } from "./workspace-icons.js";

describe("workspace icon keys", () => {
  it("keeps known workspace icon keys", () => {
    expect(normalizeWorkspaceIconKey("rocket")).toBe("rocket");
  });

  it("falls back for unknown workspace icon keys", () => {
    expect(normalizeWorkspaceIconKey("custom-svg")).toBe(DEFAULT_WORKSPACE_ICON_KEY);
    expect(normalizeWorkspaceIconKey(null)).toBe(DEFAULT_WORKSPACE_ICON_KEY);
  });
});

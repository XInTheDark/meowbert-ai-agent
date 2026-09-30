import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../environments/environment-creation.js", () => ({
  createEnvironment: vi.fn()
}));

import { createEnvironment } from "../environments/environment-creation.js";
import { buildDefaultProjectName, createDefaultProjectForWorkspace } from "./default-project.js";

describe("buildDefaultProjectName", () => {
  it("prefers a cleaned workspace name when available", () => {
    expect(buildDefaultProjectName({ workspaceName: "Acme Workspace", displayName: "Alice" })).toBe("Acme Project");
  });

  it("falls back to the display name", () => {
    expect(buildDefaultProjectName({ displayName: "Alice" })).toBe("Alice Project");
  });

  it("uses a generic fallback when no names are available", () => {
    expect(buildDefaultProjectName({})).toBe("My Project");
  });
});

describe("createDefaultProjectForWorkspace", () => {
  const mockedCreateEnvironment = vi.mocked(createEnvironment);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the default project with the derived name", async () => {
    mockedCreateEnvironment.mockResolvedValueOnce({
      id: "env-1",
      name: "Acme Project",
      rootPath: "/runtime/ws-1/env-1"
    });

    await expect(createDefaultProjectForWorkspace({
      workspaceId: "ws-1",
      userId: "user-1",
      workspaceName: "Acme Workspace"
    })).resolves.toEqual({
      id: "env-1",
      name: "Acme Project",
      rootPath: "/runtime/ws-1/env-1"
    });

    expect(mockedCreateEnvironment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      name: "Acme Project",
      createdByUserId: "user-1"
    });
  });
});

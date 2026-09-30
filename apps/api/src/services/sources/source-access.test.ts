import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockedGetSourceProviderSettings,
  mockedGetWorkspaceSourceConnection
} = vi.hoisted(() => ({
  mockedGetSourceProviderSettings: vi.fn(),
  mockedGetWorkspaceSourceConnection: vi.fn()
}));

vi.mock("./provider-settings.js", () => {
  return {
    getSourceProviderSettings: mockedGetSourceProviderSettings,
    isSourceProviderReady: vi.fn((settings: { enabled?: boolean }) => settings.enabled === true)
  };
});

vi.mock("./workspace-source-connections.js", () => ({
  getWorkspaceSourceConnection: mockedGetWorkspaceSourceConnection,
  upsertWorkspaceSourceConnection: vi.fn()
}));

import { resolveWorkspaceSourceAccess } from "./source-access.js";

describe("resolveWorkspaceSourceAccess", () => {
  beforeEach(() => {
    mockedGetSourceProviderSettings.mockReset();
    mockedGetWorkspaceSourceConnection.mockReset();
    mockedGetSourceProviderSettings.mockResolvedValue({
      provider: "rclone",
      enabled: true,
      clientId: null,
      clientSecret: null,
      extra: {}
    });
  });

  it("exposes missing workspace source connections", async () => {
    mockedGetWorkspaceSourceConnection.mockResolvedValueOnce(null);

    await expect(resolveWorkspaceSourceAccess({
      workspaceId: "workspace-1",
      provider: "rclone",
      requiresAdminCredentials: false
    })).rejects.toMatchObject({
      name: "SourceAccessError",
      statusCode: 409,
      exposeMessage: true,
      message: "This workspace has not connected the requested source yet."
    });
  });
});

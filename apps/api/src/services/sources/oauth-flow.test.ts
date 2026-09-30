import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createState: vi.fn(),
  consumeState: vi.fn(),
  getCatalogEntry: vi.fn(),
  getProviderClient: vi.fn(),
  getProviderSettings: vi.fn()
}));

vi.mock("../../lib/config.js", () => ({
  config: { server: { publicUrl: "https://api.example.com" } }
}));
vi.mock("./source-catalog.js", () => ({ getSourceCatalogEntry: mocks.getCatalogEntry }));
vi.mock("./provider-settings.js", () => ({
  getSourceProviderSettings: mocks.getProviderSettings,
  isSourceProviderReady: vi.fn((settings: { enabled: boolean }) => settings.enabled)
}));
vi.mock("./oauth-states.js", () => ({
  createWorkspaceSourceOauthState: mocks.createState,
  consumeWorkspaceSourceOauthState: mocks.consumeState
}));
vi.mock("./provider-clients.js", () => ({ getSourceProviderClient: mocks.getProviderClient }));
vi.mock("./workspace-source-connections.js", () => ({ upsertWorkspaceSourceConnection: vi.fn() }));

const { beginWorkspaceSourceOAuth, consumeWorkspaceSourceOAuth } = await import("./oauth-flow.js");

describe("source OAuth flow browser binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCatalogEntry.mockReturnValue({
      provider: "google-drive",
      manifest: { id: "google-drive" }
    });
    mocks.getProviderSettings.mockResolvedValue({
      provider: "google-drive",
      enabled: true,
      clientId: "client-id",
      clientSecret: "client-secret"
    });
    mocks.getProviderClient.mockReturnValue({
      buildAuthorizationUrl: vi.fn(() => "https://accounts.example.com/authorize")
    });
    mocks.createState.mockResolvedValue({ expiresAt: "2026-08-30T00:15:00.000Z" });
  });

  it("stores a nonce hash and returns the nonce only in an HttpOnly cookie", async () => {
    const started = await beginWorkspaceSourceOAuth({
      workspaceId: "workspace-1",
      userId: "user-1",
      sourceId: "google-drive",
      returnOrigin: "https://app.example.com"
    });
    const inserted = mocks.createState.mock.calls[0]?.[0] as { browserNonceHash: string };

    expect(inserted.browserNonceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(started.setCookieHeader).toContain("HttpOnly");
    expect(started.setCookieHeader).not.toContain(inserted.browserNonceHash);
  });

  it("rejects the current desktop cross-browser flow before storing state", async () => {
    await expect(beginWorkspaceSourceOAuth({
      workspaceId: "workspace-1",
      userId: "user-1",
      sourceId: "google-drive",
      returnOrigin: "desktop://meowbert"
    })).rejects.toThrow("completed in the web app");
    expect(mocks.createState).not.toHaveBeenCalled();
  });

  it("passes the browser nonce hash into the atomic state consume", async () => {
    mocks.consumeState.mockResolvedValueOnce(null);

    await expect(consumeWorkspaceSourceOAuth({
      provider: "google-drive",
      state: "state-1",
      browserNonce: "browser-secret"
    })).rejects.toThrow("invalid or expired");

    expect(mocks.consumeState).toHaveBeenCalledWith({
      provider: "google-drive",
      state: "state-1",
      browserNonceHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { revokeGoogleDriveTokens } from "./google-drive-revocation.js";
const tokens = { accessToken: "access", refreshToken: "refresh", tokenType: "Bearer", expiresAt: null, scope: null, raw: {} };
afterEach(() => vi.unstubAllGlobals());
it("revokes the refresh token with a POST body instead of exposing it in a URL", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 200 })); vi.stubGlobal("fetch", fetch);
  await revokeGoogleDriveTokens(tokens);
  expect(fetch).toHaveBeenCalledWith("https://oauth2.googleapis.com/revoke", expect.objectContaining({ method: "POST", body: new URLSearchParams({ token: "refresh" }) }));
});
it("accepts an already revoked token but leaves transient failures retryable", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "invalid_token" }, { status: 400 })).mockResolvedValueOnce(new Response("upstream error", { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  await expect(revokeGoogleDriveTokens(tokens)).resolves.toBeUndefined();
  await expect(revokeGoogleDriveTokens(tokens)).rejects.toThrow("Retry disconnecting");
});

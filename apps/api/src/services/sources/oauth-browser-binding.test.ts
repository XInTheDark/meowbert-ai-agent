import { describe, expect, it } from "vitest";
import {
  clearSourceOauthBrowserCookie,
  createSourceOauthBrowserBinding,
  hashSourceOauthBrowserNonce,
  readSourceOauthBrowserNonce
} from "./oauth-browser-binding.js";

describe("source OAuth browser binding", () => {
  it("creates a state-specific HttpOnly secure cookie and stores only its hash", () => {
    const binding = createSourceOauthBrowserBinding({
      provider: "google-drive",
      state: "state-1",
      secure: true
    });
    const nonce = readSourceOauthBrowserNonce(binding.setCookieHeader, "state-1");

    expect(nonce).toBeTruthy();
    expect(binding.nonceHash).toBe(hashSourceOauthBrowserNonce(nonce!));
    expect(binding.setCookieHeader).toContain("Path=/api/sources/oauth/google-drive/callback");
    expect(binding.setCookieHeader).toContain("HttpOnly");
    expect(binding.setCookieHeader).toContain("SameSite=Lax");
    expect(binding.setCookieHeader).toContain("Secure");
    expect(binding.setCookieHeader).not.toContain(binding.nonceHash);
  });

  it("does not accept a cookie created for another state", () => {
    const binding = createSourceOauthBrowserBinding({
      provider: "onedrive",
      state: "state-1",
      secure: false
    });

    expect(readSourceOauthBrowserNonce(binding.setCookieHeader, "state-2")).toBeNull();
  });

  it("clears the exact callback cookie with matching security attributes", () => {
    const header = clearSourceOauthBrowserCookie({
      provider: "outlook",
      state: "state-1",
      secure: true
    });

    expect(header).toMatch(/meowbert_source_oauth_[a-f0-9]{64}=/);
    expect(header).toContain("Path=/api/sources/oauth/outlook/callback");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Secure");
  });
});

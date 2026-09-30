import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  exchange: vi.fn()
}));

vi.mock("../services/sources/oauth-flow.js", () => ({
  buildSourceCallbackUrl: vi.fn(() => "https://api.example.com/api/sources/oauth/google-drive/callback"),
  consumeWorkspaceSourceOAuth: mocks.consume,
  exchangeWorkspaceSourceOauthState: mocks.exchange
}));
vi.mock("../services/sources/source-operations.js", () => ({
  listAvailableWorkspaceSources: vi.fn(() => [])
}));

import { createSourceOauthBrowserBinding } from "../services/sources/oauth-browser-binding.js";
import { registerSourceOauthRoutes } from "./source-oauth-routes.js";

describe("source OAuth callback browser binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a callback without the initiating browser cookie", async () => {
    const fastify = Fastify();
    registerSourceOauthRoutes(fastify);

    const response = await fastify.inject({
      method: "GET",
      url: "/api/sources/oauth/google-drive/callback?state=state-1&code=provider-code"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Source OAuth browser binding is missing or invalid" });
    expect(mocks.consume).not.toHaveBeenCalled();
    await fastify.close();
  });

  it("passes the state-specific cookie nonce into atomic state consumption", async () => {
    const fastify = Fastify();
    registerSourceOauthRoutes(fastify);
    const binding = createSourceOauthBrowserBinding({
      provider: "google-drive",
      state: "state-1",
      secure: true
    });
    const requestCookie = binding.setCookieHeader.split(";", 1)[0];
    mocks.consume.mockRejectedValueOnce(new Error("invalid"));

    const response = await fastify.inject({
      method: "GET",
      url: "/api/sources/oauth/google-drive/callback?state=state-1&code=provider-code",
      headers: { cookie: requestCookie }
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.consume).toHaveBeenCalledWith({
      provider: "google-drive",
      state: "state-1",
      browserNonce: expect.any(String)
    });
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    await fastify.close();
  });
});

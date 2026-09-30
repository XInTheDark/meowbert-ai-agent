import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import {
  OPENAI_OAUTH_DEVICE_AUTH_URL,
  OPENAI_OAUTH_DEVICE_TOKEN_URL,
  OPENAI_OAUTH_DEVICE_REDIRECT_URI,
  OPENAI_OAUTH_TOKEN_URL,
  decodeJwtPayload,
  extractChatGptClaims,
  pollChatGptDeviceAuth,
  startChatGptDeviceAuth
} from "./chatgpt-oauth.js";

const mockedQuery = vi.mocked(query);

describe("chatgpt-oauth helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockedQuery.mockReset();
  });

  it("decodes valid JWT payload", () => {
    const payload = { sub: "user-123", email: "user@example.com", name: "Test User" };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const fakeJwt = `eyJhbGciOiJIUzI1NiJ9.${encodedPayload}.signature`;

    const result = decodeJwtPayload(fakeJwt);
    expect(result).toEqual(payload);
  });

  it("returns null for malformed JWT", () => {
    expect(decodeJwtPayload("invalid-token")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });

  it("extracts email and accountId from id_token and access_token claims", () => {
    const idPayload = {
      sub: "auth0|12345",
      email: "chatgpt-user@domain.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_abcd1234"
      }
    };
    const encodedId = Buffer.from(JSON.stringify(idPayload)).toString("base64url");
    const idToken = `header.${encodedId}.sig`;

    const claims = extractChatGptClaims(idToken, undefined);
    expect(claims.email).toBe("chatgpt-user@domain.com");
    expect(claims.accountId).toBe("acct_abcd1234");
  });

  it("does not treat the Auth0 subject as a ChatGPT account ID", () => {
    const idPayload = {
      sub: "auth0|user_999",
      email: "user99@domain.com"
    };
    const encodedId = Buffer.from(JSON.stringify(idPayload)).toString("base64url");
    const idToken = `header.${encodedId}.sig`;

    const claims = extractChatGptClaims(idToken, undefined);
    expect(claims.email).toBe("user99@domain.com");
    expect(claims.accountId).toBeNull();
  });

  it("requests a Codex device code and normalizes the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      device_auth_id: "device-auth-123",
      user_code: "ABCD-1234",
      interval: "7"
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startChatGptDeviceAuth()).resolves.toEqual({
      deviceAuthId: "device-auth-123",
      userCode: "ABCD-1234",
      verificationUri: "https://auth.openai.com/codex/device",
      expiresIn: 900,
      interval: 7
    });

    expect(fetchMock).toHaveBeenCalledWith(OPENAI_OAUTH_DEVICE_AUTH_URL, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" })
    }));
  });

  it("polls the device endpoint then exchanges the authorization code with PKCE", async () => {
    const idPayload = {
      email: "chatgpt-user@domain.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_abcd1234"
      }
    };
    const encodedId = Buffer.from(JSON.stringify(idPayload)).toString("base64url");
    const idToken = `header.${encodedId}.sig`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorization_code: "authorization-code-123",
        code_challenge: "ignored-by-client",
        code_verifier: "verifier-123"
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id_token: idToken,
        access_token: "access-token-123",
        refresh_token: "refresh-token-123",
        expires_in: 3600
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);

    await expect(pollChatGptDeviceAuth("user-123", "device-auth-123", "ABCD-1234")).resolves.toEqual({
      status: "complete",
      email: "chatgpt-user@domain.com",
      accountId: "acct_abcd1234",
      forcedModel: null
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, OPENAI_OAUTH_DEVICE_TOKEN_URL, expect.objectContaining({
      body: JSON.stringify({ device_auth_id: "device-auth-123", user_code: "ABCD-1234" })
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, OPENAI_OAUTH_TOKEN_URL, expect.objectContaining({
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }));
    const exchangeBody = new URLSearchParams(fetchMock.mock.calls[1][1].body as string);
    expect(Object.fromEntries(exchangeBody.entries())).toEqual({
      grant_type: "authorization_code",
      code: "authorization-code-123",
      redirect_uri: OPENAI_OAUTH_DEVICE_REDIRECT_URI,
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      code_verifier: "verifier-123"
    });
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });
});

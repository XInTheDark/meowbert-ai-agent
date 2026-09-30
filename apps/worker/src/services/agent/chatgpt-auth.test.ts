import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import {
  OPENAI_CHATGPT_CODEX_BASE_URL,
  OPENAI_CHATGPT_CODEX_ORIGINATOR,
  refreshWorkerChatGptToken,
  resolveChatGptProvider
} from "./chatgpt-auth.js";

const mockedQuery = vi.mocked(query);

describe("worker chatgpt-auth service", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws error when user has no connected ChatGPT account", async () => {
    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: []
    });

    await expect(resolveChatGptProvider("user-no-chatgpt")).rejects.toThrow(
      "ChatGPT subscription is enabled for this user, but no connected account was found."
    );
  });

  it("returns existing valid access token and headers when token is fresh", async () => {
    const futureExpiry = new Date(Date.now() + 45 * 60 * 1000); // 45 mins from now
    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          access_token: "test_access_token_123",
          refresh_token: "test_refresh_token_456",
          expires_at: futureExpiry,
          account_id: "acct_chatgpt_789",
          forced_model: "o3-mini"
        }
      ]
    });

    const result = await resolveChatGptProvider("user-valid-token");

    expect(result.apiKey).toBe("test_access_token_123");
    expect(result.baseUrl).toBe(OPENAI_CHATGPT_CODEX_BASE_URL);
    expect(result.defaultHeaders).toEqual({
      originator: OPENAI_CHATGPT_CODEX_ORIGINATOR,
      "ChatGPT-Account-ID": "acct_chatgpt_789"
    });
    expect(result.model).toBe("o3-mini");
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it("does not inject a model when no forced model is configured", async () => {
    const futureExpiry = new Date(Date.now() + 45 * 60 * 1000);
    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          access_token: "test_access_token_123",
          refresh_token: "test_refresh_token_456",
          expires_at: futureExpiry,
          account_id: "acct_chatgpt_789",
          forced_model: null
        }
      ]
    });

    const result = await resolveChatGptProvider("user-without-forced-model");

    expect(result.model).toBeNull();
  });

  it("preserves the stored account ID when refresh omits account claims", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "refreshed_access_token",
      expires_in: 3600
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    mockedQuery.mockResolvedValueOnce({
      rows: [{ account_id: "acct_existing" }],
      rowCount: 1
    } as never);

    await expect(refreshWorkerChatGptToken("user-refresh", "refresh-token")).resolves.toEqual({
      accessToken: "refreshed_access_token",
      accountId: "acct_existing"
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      grant_type: "refresh_token",
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      refresh_token: "refresh-token"
    });
  });
});

import { query } from "../../lib/db.js";
import type { OpenAiProviderConfig } from "./openai-client.js";
import { CHATGPT_CODEX_ORIGINATOR } from "./chatgpt-request.js";

export const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const OPENAI_CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const OPENAI_CHATGPT_CODEX_ORIGINATOR = CHATGPT_CODEX_ORIGINATOR;

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const decoded = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractClaims(idToken: string | undefined, accessToken: string | undefined): {
  email: string | null;
  accountId: string | null;
} {
  const idClaims = idToken ? decodeJwtPayload(idToken) : null;
  const accessClaims = accessToken ? decodeJwtPayload(accessToken) : null;
  const email = (typeof idClaims?.email === "string" ? idClaims.email : null)
    || (typeof accessClaims?.email === "string" ? accessClaims.email : null);

  const accountId = [idClaims, accessClaims]
    .map((claims) => claims?.["https://api.openai.com/auth"])
    .filter((claims): claims is Record<string, unknown> => Boolean(claims) && typeof claims === "object" && !Array.isArray(claims))
    .map((claims) => claims.chatgpt_account_id)
    .find((value): value is string => typeof value === "string" && value.length > 0)
    ?? null;

  return { email, accountId };
}

export async function refreshWorkerChatGptToken(userId: string, refreshToken: string): Promise<{
  accessToken: string;
  accountId: string | null;
}> {
  const response = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: OPENAI_OAUTH_CLIENT_ID,
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    // If refresh failed, check if another concurrent process already refreshed the token recently
    const checkRes = await query<{
      access_token: string;
      account_id: string | null;
      expires_at: Date;
    }>(
      `SELECT access_token, account_id, expires_at
         FROM user_chatgpt_auth
        WHERE user_id = $1`,
      [userId]
    );
    if ((checkRes.rowCount ?? 0) > 0) {
      const row = checkRes.rows[0];
      const expiry = new Date(row.expires_at).getTime();
      if (expiry - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
        return {
          accessToken: row.access_token,
          accountId: row.account_id
        };
      }
    }
    const errorText = await response.text().catch(() => "");
    throw new Error(`Failed to refresh ChatGPT OAuth token: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };

  const expiresInSeconds = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const { email, accountId } = extractClaims(data.id_token, data.access_token);
  const nextRefreshToken = data.refresh_token || refreshToken;

  const updateResult = await query<{ account_id: string | null }>(
    `UPDATE user_chatgpt_auth
        SET access_token = $2,
            refresh_token = $3,
            expires_at = $4,
            email = COALESCE($5, email),
            account_id = COALESCE($6, account_id),
            updated_at = now()
      WHERE user_id = $1
      RETURNING account_id`,
    [userId, data.access_token, nextRefreshToken, expiresAt.toISOString(), email, accountId]
  );

  return {
    accessToken: data.access_token,
    accountId: updateResult.rows[0]?.account_id ?? accountId
  };
}

export async function resolveChatGptProvider(userId: string): Promise<OpenAiProviderConfig & { model: string | null }> {
  const result = await query<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    account_id: string | null;
    forced_model: string | null;
  }>(
    `SELECT access_token, refresh_token, expires_at, account_id, forced_model
       FROM user_chatgpt_auth
      WHERE user_id = $1`,
    [userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("ChatGPT subscription is enabled for this user, but no connected account was found.");
  }

  const row = result.rows[0];
  const expiresAtMs = new Date(row.expires_at).getTime();
  const now = Date.now();

  let accessToken = row.access_token;
  let accountId = row.account_id;

  if (expiresAtMs - now < TOKEN_REFRESH_BUFFER_MS) {
    const refreshed = await refreshWorkerChatGptToken(userId, row.refresh_token);
    accessToken = refreshed.accessToken;
    accountId = refreshed.accountId;
  }

  const defaultHeaders: Record<string, string> = {
    originator: OPENAI_CHATGPT_CODEX_ORIGINATOR
  };
  if (accountId) {
    defaultHeaders["ChatGPT-Account-ID"] = accountId;
  }

  return {
    apiKey: accessToken,
    baseUrl: OPENAI_CHATGPT_CODEX_BASE_URL,
    defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
    chatGptCodex: true,
    model: row.forced_model
  };
}

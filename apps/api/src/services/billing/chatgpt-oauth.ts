import { query } from "../../lib/db.js";

export const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_OAUTH_DEVICE_AUTH_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
export const OPENAI_OAUTH_DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
export const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const OPENAI_OAUTH_DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";
export const OPENAI_OAUTH_DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
export const OPENAI_CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

export interface ChatGptDeviceStartResponse {
  userCode: string;
  verificationUri: string;
  deviceAuthId: string;
  expiresIn: number;
  interval: number;
}

export type ChatGptDevicePollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired"; error: string }
  | { status: "denied"; error: string }
  | { status: "error"; error: string }
  | {
      status: "complete";
      email: string | null;
      accountId: string | null;
      forcedModel: string | null;
    };

export interface UserChatGptAuthStatus {
  isConnected: boolean;
  email: string | null;
  accountId: string | null;
  forcedModel: string | null;
  expiresAt: string | null;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }
    const decoded = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getAuthClaims(claims: Record<string, unknown> | null): Record<string, unknown> | null {
  const authClaims = claims?.["https://api.openai.com/auth"];
  if (!authClaims || typeof authClaims !== "object" || Array.isArray(authClaims)) {
    return null;
  }
  return authClaims as Record<string, unknown>;
}

export function extractChatGptClaims(idToken: string | undefined, accessToken: string | undefined): {
  email: string | null;
  accountId: string | null;
} {
  const idClaims = idToken ? decodeJwtPayload(idToken) : null;
  const accessClaims = accessToken ? decodeJwtPayload(accessToken) : null;

  const email = (typeof idClaims?.email === "string" ? idClaims.email : null)
    || (typeof accessClaims?.email === "string" ? accessClaims.email : null);

  const accountId = [idClaims, accessClaims]
    .map(getAuthClaims)
    .map((authClaims) => authClaims?.chatgpt_account_id)
    .find((value): value is string => typeof value === "string" && value.length > 0)
    ?? null;

  return { email, accountId };
}

function parseInterval(value: unknown): number {
  const interval = typeof value === "number" ? value : Number(value);
  return Number.isFinite(interval) && interval >= 0 ? interval : 5;
}

function parseExpiresIn(value: unknown): number {
  const expiresIn = typeof value === "number" ? value : Number(value);
  return Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`OpenAI response is missing ${field}.`);
  }
  return value;
}

async function readRemoteError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body) {
    return `HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(body) as { error?: unknown; error_description?: unknown };
    const error = typeof parsed.error === "string" ? parsed.error : null;
    const description = typeof parsed.error_description === "string" ? parsed.error_description : null;
    return description || error || body;
  } catch {
    return body;
  }
}

interface ChatGptTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | undefined;
  expiresIn: number;
}

async function parseTokenResponse(response: Response): Promise<ChatGptTokenResponse> {
  const data = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    id_token?: unknown;
    expires_in?: unknown;
  };

  return {
    accessToken: requireString(data.access_token, "access_token"),
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    idToken: typeof data.id_token === "string" ? data.id_token : undefined,
    expiresIn: parseExpiresIn(data.expires_in)
  };
}

export async function startChatGptDeviceAuth(): Promise<ChatGptDeviceStartResponse> {
  const response = await fetch(OPENAI_OAUTH_DEVICE_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: OPENAI_OAUTH_CLIENT_ID
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Failed to initiate device authentication with OpenAI: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    device_auth_id?: unknown;
    user_code?: unknown;
    interval?: unknown;
  };

  return {
    deviceAuthId: requireString(data.device_auth_id, "device_auth_id"),
    userCode: requireString(data.user_code, "user_code"),
    verificationUri: OPENAI_OAUTH_DEVICE_VERIFICATION_URL,
    expiresIn: 15 * 60,
    interval: parseInterval(data.interval)
  };
}

interface DeviceAuthCodeResponse {
  authorizationCode: string;
  codeVerifier: string;
}

async function requestDeviceAuthCode(
  deviceAuthId: string,
  userCode: string
): Promise<DeviceAuthCodeResponse | ChatGptDevicePollResult> {
  const response = await fetch(OPENAI_OAUTH_DEVICE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      device_auth_id: deviceAuthId,
      user_code: userCode
    })
  });

  if (response.status === 403 || response.status === 404) {
    return { status: "pending" };
  }

  if (!response.ok) {
    const error = await readRemoteError(response);
    if (error === "authorization_pending") return { status: "pending" };
    if (error === "slow_down") return { status: "slow_down" };
    if (error === "expired_token" || error === "device_code_expired") {
      return { status: "expired", error: "Device authorization expired. Please try again." };
    }
    if (error === "access_denied" || error === "authorization_declined") {
      return { status: "denied", error: "Authorization was denied." };
    }
    return { status: "error", error };
  }

  const data = (await response.json()) as {
    authorization_code?: unknown;
    code_verifier?: unknown;
  };

  return {
    authorizationCode: requireString(data.authorization_code, "authorization_code"),
    codeVerifier: requireString(data.code_verifier, "code_verifier")
  };
}

async function exchangeDeviceAuthCode(code: DeviceAuthCodeResponse): Promise<ChatGptTokenResponse> {
  const response = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code.authorizationCode,
      redirect_uri: OPENAI_OAUTH_DEVICE_REDIRECT_URI,
      client_id: OPENAI_OAUTH_CLIENT_ID,
      code_verifier: code.codeVerifier
    }).toString()
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange ChatGPT authorization code: ${response.status} ${await readRemoteError(response)}`);
  }

  return parseTokenResponse(response);
}

async function persistChatGptTokens(userId: string, tokens: ChatGptTokenResponse): Promise<{
  email: string | null;
  accountId: string | null;
}> {
  if (!tokens.refreshToken) {
    throw new Error("OpenAI response is missing refresh_token.");
  }

  const { email, accountId } = extractChatGptClaims(tokens.idToken, tokens.accessToken);
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

  await query(
    `INSERT INTO user_chatgpt_auth (
       user_id,
       access_token,
       refresh_token,
       expires_at,
       account_id,
       email,
       forced_model,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, NULL, now())
     ON CONFLICT (user_id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at,
           account_id = EXCLUDED.account_id,
           email = EXCLUDED.email,
           updated_at = now()`,
    [userId, tokens.accessToken, tokens.refreshToken, expiresAt.toISOString(), accountId, email]
  );

  await query(
    `UPDATE users
        SET byo_enabled = true,
            byo_provider = 'chatgpt_oauth',
            updated_at = now()
      WHERE id = $1`,
    [userId]
  );

  return { email, accountId };
}

export async function pollChatGptDeviceAuth(
  userId: string,
  deviceAuthId: string,
  userCode: string
): Promise<ChatGptDevicePollResult> {
  try {
    const code = await requestDeviceAuthCode(deviceAuthId, userCode);
    if ("status" in code) {
      return code;
    }

    const tokens = await exchangeDeviceAuthCode(code);
    const claims = await persistChatGptTokens(userId, tokens);
    return {
      status: "complete",
      ...claims,
      forcedModel: null
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function getUserChatGptAuth(userId: string): Promise<UserChatGptAuthStatus> {
  const result = await query<{
    email: string | null;
    account_id: string | null;
    forced_model: string | null;
    expires_at: Date;
  }>(
    `SELECT email, account_id, forced_model, expires_at
       FROM user_chatgpt_auth
      WHERE user_id = $1`,
    [userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return {
      isConnected: false,
      email: null,
      accountId: null,
      forcedModel: null,
      expiresAt: null
    };
  }

  const row = result.rows[0];
  return {
    isConnected: true,
    email: row.email,
    accountId: row.account_id,
    forcedModel: row.forced_model,
    expiresAt: row.expires_at.toISOString()
  };
}

export async function disconnectUserChatGptAuth(userId: string): Promise<void> {
  await query("DELETE FROM user_chatgpt_auth WHERE user_id = $1", [userId]);

  await query(
    `UPDATE users
        SET byo_enabled = CASE WHEN byo_provider = 'chatgpt_oauth' THEN false ELSE byo_enabled END,
            byo_provider = CASE WHEN byo_provider = 'chatgpt_oauth' THEN NULL ELSE byo_provider END,
            updated_at = now()
      WHERE id = $1`,
    [userId]
  );
}

export async function updateUserChatGptForcedModel(userId: string, forcedModel: string | null): Promise<void> {
  await query(
    `UPDATE user_chatgpt_auth
        SET forced_model = $2,
            updated_at = now()
      WHERE user_id = $1`,
    [userId, forcedModel?.trim() || null]
  );
}

export async function refreshChatGptToken(userId: string, refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
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
    const errorText = await response.text().catch(() => "");
    throw new Error(`Failed to refresh ChatGPT access token: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    id_token?: unknown;
    expires_in?: unknown;
  };

  const tokens: ChatGptTokenResponse = {
    accessToken: requireString(data.access_token, "access_token"),
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    idToken: typeof data.id_token === "string" ? data.id_token : undefined,
    expiresIn: parseExpiresIn(data.expires_in)
  };
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  const { email, accountId } = extractChatGptClaims(tokens.idToken, tokens.accessToken);
  const nextRefreshToken = tokens.refreshToken || refreshToken;

  await query(
    `UPDATE user_chatgpt_auth
        SET access_token = $2,
            refresh_token = $3,
            expires_at = $4,
            email = COALESCE($5, email),
            account_id = COALESCE($6, account_id),
            updated_at = now()
      WHERE user_id = $1`,
    [userId, tokens.accessToken, nextRefreshToken, expiresAt.toISOString(), email, accountId]
  );

  return {
    accessToken: tokens.accessToken,
    refreshToken: nextRefreshToken,
    expiresAt
  };
}

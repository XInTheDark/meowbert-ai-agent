import type { StoredSourceTokens } from "./source-types.js";

function summarizeSourceError(prefix: string, payload: unknown, status: number): never {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const topMessage = typeof record.error_description === "string"
      ? record.error_description
      : typeof record.error === "string"
        ? record.error
        : null;
    const nestedError = record.error;
    const nestedMessage = nestedError && typeof nestedError === "object" && !Array.isArray(nestedError)
      ? typeof (nestedError as Record<string, unknown>).message === "string"
        ? (nestedError as Record<string, unknown>).message as string
        : null
      : null;
    throw new Error(`${prefix}: ${nestedMessage ?? topMessage ?? `HTTP ${status}`}`);
  }

  throw new Error(`${prefix}: HTTP ${status}`);
}

export async function fetchJsonOrThrow<T>(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  errorPrefix: string;
}): Promise<T> {
  const response = await fetch(input.url, {
    method: input.method ?? "GET",
    headers: input.headers,
    body: input.body
  });

  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = null;
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => "");
    payload = text ? { error: text } : null;
  }

  if (!response.ok) {
    summarizeSourceError(input.errorPrefix, payload, response.status);
  }

  return payload as T;
}

export function buildSourceBearerHeaders(accessToken: string, extra?: Record<string, string>): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    ...(extra ?? {})
  };
}

export function buildStoredSourceTokens(input: {
  payload: Record<string, unknown>;
  fallbackRefreshToken?: string | null;
}): StoredSourceTokens {
  const accessToken = typeof input.payload.access_token === "string"
    ? input.payload.access_token
    : typeof input.payload.accessToken === "string"
      ? input.payload.accessToken
      : "";
  if (!accessToken) {
    throw new Error("OAuth token response did not include an access token.");
  }

  const refreshToken = typeof input.payload.refresh_token === "string"
    ? input.payload.refresh_token
    : typeof input.payload.refreshToken === "string"
      ? input.payload.refreshToken
      : (input.fallbackRefreshToken ?? null);
  const expiresIn = typeof input.payload.expires_in === "number"
    ? input.payload.expires_in
    : typeof input.payload.expires_in === "string"
      ? Number.parseInt(input.payload.expires_in, 10)
      : null;
  const expiresAt = typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
  const scope = typeof input.payload.scope === "string" ? input.payload.scope : null;
  const tokenType = typeof input.payload.token_type === "string"
    ? input.payload.token_type
    : typeof input.payload.tokenType === "string"
      ? input.payload.tokenType
      : null;

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scope,
    tokenType,
    raw: input.payload
  };
}

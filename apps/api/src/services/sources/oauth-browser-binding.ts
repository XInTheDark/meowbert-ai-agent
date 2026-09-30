import crypto from "node:crypto";
import type { SourceProvider } from "./source-types.js";

const SOURCE_OAUTH_COOKIE_MAX_AGE_SECONDS = 15 * 60;
const SOURCE_OAUTH_COOKIE_PREFIX = "meowbert_source_oauth_";

function getSourceOauthCookieName(state: string): string {
  const stateHash = crypto.createHash("sha256").update(state).digest("hex");
  return `${SOURCE_OAUTH_COOKIE_PREFIX}${stateHash}`;
}

function getSourceOauthCookiePath(provider: SourceProvider): string {
  return `/api/sources/oauth/${provider}/callback`;
}

function buildCookieAttributes(input: { provider: SourceProvider; secure: boolean }): string[] {
  return [
    `Path=${getSourceOauthCookiePath(input.provider)}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(input.secure ? ["Secure"] : [])
  ];
}

export function hashSourceOauthBrowserNonce(nonce: string): string {
  return crypto.createHash("sha256").update(nonce).digest("hex");
}

export function createSourceOauthBrowserBinding(input: {
  provider: SourceProvider;
  state: string;
  secure: boolean;
}): { nonceHash: string; setCookieHeader: string } {
  const nonce = crypto.randomBytes(32).toString("base64url");
  return {
    nonceHash: hashSourceOauthBrowserNonce(nonce),
    setCookieHeader: [
      `${getSourceOauthCookieName(input.state)}=${nonce}`,
      ...buildCookieAttributes(input),
      `Max-Age=${SOURCE_OAUTH_COOKIE_MAX_AGE_SECONDS}`
    ].join("; ")
  };
}

export function readSourceOauthBrowserNonce(cookieHeader: string | undefined, state: string): string | null {
  const expectedName = getSourceOauthCookieName(state);
  for (const cookie of cookieHeader?.split(";") ?? []) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex < 0 || cookie.slice(0, separatorIndex).trim() !== expectedName) {
      continue;
    }

    const value = cookie.slice(separatorIndex + 1).trim();
    return value.length > 0 ? value : null;
  }

  return null;
}

export function clearSourceOauthBrowserCookie(input: {
  provider: SourceProvider;
  state: string;
  secure: boolean;
}): string {
  return [
    `${getSourceOauthCookieName(input.state)}=`,
    ...buildCookieAttributes(input),
    "Max-Age=0"
  ].join("; ");
}

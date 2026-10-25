import type { StoredSourceTokens } from "./source-types.js";

// Revoke first so a failed network request leaves the connection available for retry.
export async function revokeGoogleDriveTokens(tokens: StoredSourceTokens): Promise<void> {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: tokens.refreshToken ?? tokens.accessToken }),
    signal: AbortSignal.timeout(15_000)
  });
  if (response.ok) return;
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (response.status === 400 && payload?.error === "invalid_token") return;
  throw new Error("Google Drive access could not be revoked. Retry disconnecting before removing this connection.");
}

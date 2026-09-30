import { createSign } from "node:crypto";
import {
  normalizeGitHubAppPrivateKeyPem,
  summarizeGitHubInstallationAccess,
  type GitHubInstallationAccessSummary
} from "@meowbert/shared";

interface GitHubInstallationTokenResponse {
  token?: string;
  expires_at?: string;
  permissions?: Record<string, unknown>;
  repository_selection?: string;
}

interface GitHubApiErrorResponse {
  message?: string;
}

const DEFAULT_GITHUB_INSTALLATION_TOKEN_TIMEOUT_MS = 15_000;

function base64UrlEncodeJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createGitHubAppJwt(input: {
  appId: number;
  privateKeyPem: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlEncodeJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: input.appId
  });

  const unsignedToken = `${header}.${payload}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256")
      .update(unsignedToken)
      .end()
      .sign(normalizeGitHubAppPrivateKeyPem(input.privateKeyPem), "base64url");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub App private key is invalid or unsupported: ${message}`);
  }

  return `${unsignedToken}.${signature}`;
}

export async function mintGitHubInstallationToken(input: {
  appId: number;
  privateKeyPem: string;
  installationId: number;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ token: string; expiresAt: string | null } & GitHubInstallationAccessSummary> {
  const appJwt = createGitHubAppJwt({
    appId: input.appId,
    privateKeyPem: input.privateKeyPem
  });

  const timeoutMs = Math.max(1_000, input.timeoutMs ?? DEFAULT_GITHUB_INSTALLATION_TOKEN_TIMEOUT_MS);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = input.abortSignal
    ? AbortSignal.any([input.abortSignal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/app/installations/${input.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${appJwt}`,
          accept: "application/vnd.github+json",
          "user-agent": "meowbert-worker"
        },
        signal: requestSignal
      }
    );
  } catch (error) {
    if (input.abortSignal?.aborted) {
      throw new Error("GitHub installation token request was cancelled");
    }
    if (timeoutSignal.aborted) {
      throw new Error(`GitHub installation token request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error("GitHub installation token response returned invalid JSON");
  }

  if (!response.ok) {
    const errorPayload = parsed as GitHubApiErrorResponse | null;
    throw new Error(
      errorPayload && typeof errorPayload.message === "string"
        ? errorPayload.message
        : `GitHub installation token request failed with HTTP ${response.status}`
    );
  }

  const tokenResponse = parsed as GitHubInstallationTokenResponse;
  if (typeof tokenResponse.token !== "string" || tokenResponse.token.trim().length === 0) {
    throw new Error("GitHub installation token response did not include a token");
  }

  return {
    token: tokenResponse.token,
    expiresAt:
      typeof tokenResponse.expires_at === "string" && tokenResponse.expires_at.trim().length > 0
        ? tokenResponse.expires_at
        : null,
    ...summarizeGitHubInstallationAccess({
      permissions: tokenResponse.permissions,
      repositorySelection: tokenResponse.repository_selection
    })
  };
}

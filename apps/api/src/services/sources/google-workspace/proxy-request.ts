import { buildSourceBearerHeaders } from "../provider-http.js";
import { resolveWorkspaceSourceAccess } from "../source-access.js";
import { sourceConnectionCanWrite } from "../workspace-source-connections.js";
import type { AuthorizedGoogleWorkspaceRequest } from "./proxy-policy.js";
import { GoogleWorkspaceProxyError } from "./proxy-errors.js";
import type { GoogleWorkspaceReferencePayload } from "./reference-types.js";

const GOOGLE_WORKSPACE_PROXY_TIMEOUT_MS = 120_000;

function buildResourceKeyHeader(reference: GoogleWorkspaceReferencePayload): Record<string, string> {
  if (!reference.resourceKey) {
    return {};
  }
  return {
    "x-goog-drive-resource-keys": `${reference.itemId}/${reference.resourceKey}`
  };
}

function selectResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ["content-type", "etag", "retry-after", "x-guploader-uploadid"]) {
    const value = headers.get(name);
    if (value) {
      result[name] = value;
    }
  }
  return result;
}

export async function executeGoogleWorkspaceProxyRequest(input: {
  workspaceId: string;
  request: AuthorizedGoogleWorkspaceRequest;
  reference: GoogleWorkspaceReferencePayload;
}): Promise<{ status: number; headers: Record<string, string>; bodyBase64: string }> {
  const access = await resolveWorkspaceSourceAccess({
    workspaceId: input.workspaceId,
    provider: "google-drive"
  });
  if (input.request.mutating && !sourceConnectionCanWrite(access.connection)) {
    throw new GoogleWorkspaceProxyError(
      "Reconnect Google Drive with write access before editing Google Workspace files.",
      409
    );
  }

  let response: Response;
  try {
    response = await fetch(input.request.url, {
      method: input.request.method,
      headers: {
        ...input.request.headers,
        ...buildSourceBearerHeaders(access.accessToken, buildResourceKeyHeader(input.reference))
      },
      body: input.request.body ? new Uint8Array(input.request.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(GOOGLE_WORKSPACE_PROXY_TIMEOUT_MS)
    });
  } catch {
    throw new GoogleWorkspaceProxyError("Google Workspace API request failed.", 502);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new GoogleWorkspaceProxyError("Google Workspace API redirect was rejected.", 502);
  }

  const body = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    headers: selectResponseHeaders(response.headers),
    bodyBase64: body.toString("base64")
  };
}

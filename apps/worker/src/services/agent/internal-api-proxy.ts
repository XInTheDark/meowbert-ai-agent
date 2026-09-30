import { createHmac, randomUUID } from "node:crypto";
import { config } from "../../lib/config.js";

const INTERNAL_PROXY_TICKET_TTL_SECONDS = 8 * 60 * 60;

export type InternalProxyScope = "source_proxy" | "source_reference_proxy" | "live_sync_proxy" | "project_master_proxy";

function base64url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function signInternalScopedAccessTicket(input: {
  scope: InternalProxyScope;
  userId: string;
  taskId?: string | null;
  workspaceId?: string | null;
  sourceId?: string | null;
}): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    kind: "scoped_access_ticket",
    scope: input.scope,
    userId: input.userId,
    taskId: input.taskId ?? null,
    sessionId: null,
    workspaceId: input.workspaceId ?? null,
    sourceId: input.sourceId ?? null,
    jti: randomUUID(),
    iat: now,
    exp: now + INTERNAL_PROXY_TICKET_TTL_SECONDS
  }));
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", config.security.jwtSecret).update(unsigned).digest();
  return `${unsigned}.${base64url(signature)}`;
}

export function resolveInternalApiBaseUrl(): string {
  const configured = config.server.internalUrl ?? config.server.publicUrl;
  const url = new URL(configured);
  if (!config.server.internalUrl && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    url.hostname = "host.docker.internal";
  }
  return url.toString().replace(/\/+$/, "");
}

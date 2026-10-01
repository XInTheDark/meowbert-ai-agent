import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

const SCOPED_ACCESS_TICKET_TTL_SECONDS = 60;
// Preview tickets live in iframe URLs: every link, asset, and later fetch inside a
// multi-page artifact reuses the ticket, so it must outlast a normal viewing session.
const PREVIEW_TICKET_TTL_SECONDS = 8 * 60 * 60;

export type ScopedAccessTicketScope =
  | "task_events_stream"
  | "workspace_notifications_stream"
  | "task_inline_file_view"
  | "project_canvas_preview"
  | "desktop_computer_stream"
  | "source_proxy"
  | "source_reference_proxy"
  | "live_sync_proxy"
  | "project_master_proxy";

interface ScopedAccessTicketPayload {
  kind: "scoped_access_ticket";
  scope: ScopedAccessTicketScope;
  userId: string;
  taskId: string | null;
  sessionId: string | null;
  workspaceId: string | null;
  sourceId: string | null;
  jti: string;
  iat?: number;
  exp?: number;
}

export interface ScopedAccessTicket {
  ticket: string;
  expiresAt: string;
}

export class ScopedAccessTicketError extends Error {
  readonly statusCode = 401;

  constructor(message = "Unauthorized") {
    super(message);
    this.name = "ScopedAccessTicketError";
  }
}

export function getScopedAccessTicketTtlSeconds(scope: ScopedAccessTicketScope): number {
  return scope === "task_inline_file_view" || scope === "project_canvas_preview"
    ? PREVIEW_TICKET_TTL_SECONDS
    : SCOPED_ACCESS_TICKET_TTL_SECONDS;
}

function assertScopedAccessTicketPayload(payload: unknown): ScopedAccessTicketPayload {
  if (!payload || typeof payload !== "object") {
    throw new ScopedAccessTicketError();
  }

  const candidate = payload as Partial<ScopedAccessTicketPayload>;
  if (
    candidate.kind !== "scoped_access_ticket"
    || typeof candidate.scope !== "string"
    || typeof candidate.userId !== "string"
    || typeof candidate.taskId !== "string" && candidate.taskId !== null
    || typeof candidate.sessionId !== "string" && candidate.sessionId !== null
    || typeof candidate.workspaceId !== "string" && candidate.workspaceId !== null
    || typeof candidate.sourceId !== "string" && candidate.sourceId !== null
    || typeof candidate.jti !== "string"
  ) {
    throw new ScopedAccessTicketError();
  }

  return {
    kind: candidate.kind,
    scope: candidate.scope as ScopedAccessTicketScope,
    userId: candidate.userId,
    taskId: candidate.taskId,
    sessionId: candidate.sessionId,
    workspaceId: candidate.workspaceId,
    sourceId: candidate.sourceId,
    jti: candidate.jti,
    iat: candidate.iat,
    exp: candidate.exp
  };
}

export async function issueScopedAccessTicket(
  app: FastifyInstance,
  input: {
    scope: ScopedAccessTicketScope;
    userId: string;
    taskId?: string | null;
    sessionId?: string | null;
    workspaceId?: string | null;
    sourceId?: string | null;
  }
): Promise<ScopedAccessTicket> {
  const ttlSeconds = getScopedAccessTicketTtlSeconds(input.scope);
  const expiresAt = new Date(Date.now() + (ttlSeconds * 1000)).toISOString();
  const signTicket = app.jwt.sign as unknown as (
    payload: ScopedAccessTicketPayload,
    options?: { expiresIn?: number }
  ) => string | Promise<string>;
  const ticket = await signTicket(
    {
      kind: "scoped_access_ticket",
      scope: input.scope,
      userId: input.userId,
      taskId: input.taskId ?? null,
      sessionId: input.sessionId ?? null,
      workspaceId: input.workspaceId ?? null,
      sourceId: input.sourceId ?? null,
      jti: randomUUID()
    },
    {
      expiresIn: ttlSeconds
    }
  );

  return {
    ticket,
    expiresAt
  };
}

export async function verifyScopedAccessTicket(
  app: FastifyInstance,
  input: {
    ticket: string;
    scope: ScopedAccessTicketScope;
    taskId?: string;
    sessionId?: string;
    workspaceId?: string;
    sourceId?: string;
  }
): Promise<ScopedAccessTicketPayload> {
  let verifiedPayload: unknown;
  try {
    const verifyTicket = app.jwt.verify as unknown as (ticket: string) => Promise<unknown> | unknown;
    verifiedPayload = await verifyTicket(input.ticket);
  } catch {
    throw new ScopedAccessTicketError();
  }

  const payload = assertScopedAccessTicketPayload(verifiedPayload);
  if (payload.scope !== input.scope) {
    throw new ScopedAccessTicketError();
  }
  if (input.taskId !== undefined && payload.taskId !== input.taskId) {
    throw new ScopedAccessTicketError();
  }
  if (input.sessionId !== undefined && payload.sessionId !== input.sessionId) {
    throw new ScopedAccessTicketError();
  }
  if (input.workspaceId !== undefined && payload.workspaceId !== input.workspaceId) {
    throw new ScopedAccessTicketError();
  }
  if (input.sourceId !== undefined && payload.sourceId !== input.sourceId) {
    throw new ScopedAccessTicketError();
  }

  return payload;
}

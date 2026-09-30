import { query } from "../../../lib/db.js";
import type { EmailInboundProvider } from "./inbound-settings.js";

export type EmailInboundDebugLevel = "info" | "warn" | "error";

interface EmailInboundDebugEventRow {
  id: string;
  provider: EmailInboundProvider;
  workspace_id: string | null;
  binding_id: string | null;
  event_type: string;
  level: EmailInboundDebugLevel;
  message: string;
  details_json: unknown;
  created_at: string;
}

export interface EmailInboundDebugEvent {
  id: string;
  provider: EmailInboundProvider;
  workspaceId: string | null;
  bindingId: string | null;
  eventType: string;
  level: EmailInboundDebugLevel;
  message: string;
  details: unknown;
  createdAt: string;
}

function normalizeMessage(value: string, fallbackEventType: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallbackEventType.slice(0, 240) || "event";
  }

  return trimmed.slice(0, 2_000);
}

function normalizeDetails(value: unknown): unknown {
  if (value === undefined) {
    return {};
  }

  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return {
      serializationError: "details_not_json_serializable"
    };
  }
}

function mapRow(row: EmailInboundDebugEventRow): EmailInboundDebugEvent {
  return {
    id: row.id,
    provider: row.provider,
    workspaceId: row.workspace_id,
    bindingId: row.binding_id,
    eventType: row.event_type,
    level: row.level,
    message: row.message,
    details: row.details_json,
    createdAt: row.created_at
  };
}

export async function appendEmailInboundDebugEvent(input: {
  provider?: EmailInboundProvider;
  workspaceId?: string | null;
  bindingId?: string | null;
  eventType: string;
  level?: EmailInboundDebugLevel;
  message: string;
  details?: unknown;
}): Promise<void> {
  const provider = input.provider ?? "brevo";
  const eventType = input.eventType.trim().slice(0, 120) || "event";
  const level = input.level ?? "info";
  const message = normalizeMessage(input.message, eventType);
  const details = normalizeDetails(input.details);

  await query(
    `INSERT INTO email_inbound_debug_events (
      provider,
      workspace_id,
      binding_id,
      event_type,
      level,
      message,
      details_json
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7::jsonb
    )`,
    [
      provider,
      input.workspaceId ?? null,
      input.bindingId ?? null,
      eventType,
      level,
      message,
      JSON.stringify(details)
    ]
  );
}

export async function listEmailInboundDebugEvents(input?: {
  provider?: EmailInboundProvider;
  limit?: number;
}): Promise<EmailInboundDebugEvent[]> {
  const limitRaw = input?.limit;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw as number))) : 200;
  const provider = input?.provider ?? "brevo";

  const result = await query<EmailInboundDebugEventRow>(
    `SELECT id,
            provider,
            workspace_id,
            binding_id,
            event_type,
            level,
            message,
            details_json,
            created_at::text
       FROM email_inbound_debug_events
      WHERE provider = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [provider, limit]
  );

  return result.rows.map(mapRow);
}

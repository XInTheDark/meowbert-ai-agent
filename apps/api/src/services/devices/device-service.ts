import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../../lib/db.js";
import {
  DEFAULT_LOCAL_DEVICE_CAPACITY
} from "@meowbert/shared";

export interface DeviceRegistrationInput {
  id?: string;
  name: string;
  platform: string;
  architecture: string;
  executorVersion: string;
  capabilities?: Record<string, unknown>;
  consent?: Record<string, unknown>;
  maxConcurrentRuns?: number;
  verifiedRoots?: Record<string, unknown>;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  name: string;
  platform: string;
  architecture: string;
  executorVersion: string;
  capabilities: Record<string, unknown>;
  consent: Record<string, unknown>;
  maxConcurrentRuns: number;
  verifiedRoots: Record<string, unknown>;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

function rowToDevice(row: Record<string, unknown>): DeviceRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    platform: String(row.platform),
    architecture: String(row.architecture),
    executorVersion: String(row.executor_version),
    capabilities: (row.capabilities_json && typeof row.capabilities_json === "object" ? row.capabilities_json : {}) as Record<string, unknown>,
    consent: (row.consent_json && typeof row.consent_json === "object" ? row.consent_json : {}) as Record<string, unknown>,
    maxConcurrentRuns: Number(row.max_concurrent_runs ?? DEFAULT_LOCAL_DEVICE_CAPACITY),
    verifiedRoots: (row.verified_roots_json && typeof row.verified_roots_json === "object" ? row.verified_roots_json : {}) as Record<string, unknown>,
    lastSeenAt: typeof row.last_seen_at === "string" ? row.last_seen_at : null,
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null
  };
}

export async function registerDevice(userId: string, input: DeviceRegistrationInput): Promise<DeviceRecord> {
  const id = input.id ?? randomUUID();
  const result = await query(
    `INSERT INTO devices (
       id, user_id, name, platform, architecture, executor_version,
       capabilities_json, consent_json, max_concurrent_runs, verified_roots_json, last_seen_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::jsonb, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       platform = EXCLUDED.platform,
       architecture = EXCLUDED.architecture,
       executor_version = EXCLUDED.executor_version,
       capabilities_json = EXCLUDED.capabilities_json,
       consent_json = EXCLUDED.consent_json,
       max_concurrent_runs = EXCLUDED.max_concurrent_runs,
       verified_roots_json = EXCLUDED.verified_roots_json,
       last_seen_at = now(),
       updated_at = now()
     WHERE devices.user_id = EXCLUDED.user_id AND devices.revoked_at IS NULL
     RETURNING id, user_id, name, platform, architecture, executor_version,
       capabilities_json, consent_json, max_concurrent_runs, verified_roots_json,
       last_seen_at::text, revoked_at::text`,
    [
      id,
      userId,
      input.name.trim(),
      input.platform.trim(),
      input.architecture.trim(),
      input.executorVersion.trim(),
      JSON.stringify(input.capabilities ?? {}),
      JSON.stringify(input.consent ?? {}),
      input.maxConcurrentRuns ?? DEFAULT_LOCAL_DEVICE_CAPACITY,
      JSON.stringify(input.verifiedRoots ?? {})
    ]
  );
  if (!result.rows[0]) throw new Error("A device with this id is already registered to another user.");
  return rowToDevice(result.rows[0]);
}

export async function listDevices(userId: string): Promise<DeviceRecord[]> {
  const result = await query(
    `SELECT id, user_id, name, platform, architecture, executor_version,
            capabilities_json, consent_json, max_concurrent_runs, verified_roots_json,
            last_seen_at::text, revoked_at::text
       FROM devices
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at ASC`,
    [userId]
  );
  return result.rows.map(rowToDevice);
}

export async function updateDevice(userId: string, deviceId: string, input: Partial<DeviceRegistrationInput>): Promise<DeviceRecord | null> {
  const result = await query(
    `UPDATE devices
        SET name = COALESCE($3, name),
            executor_version = COALESCE($4, executor_version),
            capabilities_json = COALESCE($5::jsonb, capabilities_json),
            consent_json = COALESCE($6::jsonb, consent_json),
            max_concurrent_runs = COALESCE($7, max_concurrent_runs),
            verified_roots_json = COALESCE($8::jsonb, verified_roots_json),
            last_seen_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id, user_id, name, platform, architecture, executor_version,
        capabilities_json, consent_json, max_concurrent_runs, verified_roots_json,
        last_seen_at::text, revoked_at::text`,
    [
      deviceId,
      userId,
      input.name?.trim() || null,
      input.executorVersion?.trim() || null,
      input.capabilities ? JSON.stringify(input.capabilities) : null,
      input.consent ? JSON.stringify(input.consent) : null,
      input.maxConcurrentRuns ?? null,
      input.verifiedRoots ? JSON.stringify(input.verifiedRoots) : null
    ]
  );
  return result.rows[0] ? rowToDevice(result.rows[0]) : null;
}

export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const result = await client.query(
    `UPDATE devices SET revoked_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [deviceId, userId]
  );
    if ((result.rowCount ?? 0) === 0) return false;
    await client.query(
      `UPDATE task_run_dispatches SET lease_epoch = lease_epoch + 1
        WHERE lease_device_id = $1 AND queue_state = 'running'`, [deviceId]
    );
    return true;
  });
}

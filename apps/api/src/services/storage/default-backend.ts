import type { PoolClient } from "pg";
import { query } from "../../lib/db.js";
import { storageBackendRegistry } from "./backend-registry.js";

async function runQuery<T extends object>(sql: string, params: unknown[] = [], client?: PoolClient): Promise<{
  rows: T[];
  rowCount: number | null;
}> {
  if (client) {
    const result = await client.query<T>(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount
    };
  }

  const result = await query<T>(sql, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount
  };
}

function assertConfiguredBackendId(backendId: string): string {
  const trimmed = backendId.trim();
  storageBackendRegistry.getBackend(trimmed);
  return trimmed;
}

export async function getDefaultWorkspaceStorageBackendId(client?: PoolClient): Promise<string> {
  const fallbackBackendId = storageBackendRegistry.getConfiguredDefaultBackendId();
  const result = await runQuery<{ default_workspace_storage_backend_id: string | null }>(
    `SELECT default_workspace_storage_backend_id
       FROM platform_settings
      WHERE id = 1`,
    [],
    client
  );

  const persistedBackendId = result.rows[0]?.default_workspace_storage_backend_id?.trim();
  if (persistedBackendId) {
    try {
      return assertConfiguredBackendId(persistedBackendId);
    } catch {
      return assertConfiguredBackendId(fallbackBackendId);
    }
  }

  return assertConfiguredBackendId(fallbackBackendId);
}

export async function updateDefaultWorkspaceStorageBackendId(backendId: string): Promise<string> {
  const normalizedBackendId = assertConfiguredBackendId(backendId);
  await query(
    `INSERT INTO platform_settings (id, default_workspace_storage_backend_id)
     VALUES (1, $1)
     ON CONFLICT (id)
     DO UPDATE SET default_workspace_storage_backend_id = EXCLUDED.default_workspace_storage_backend_id,
                   updated_at = now()`,
    [normalizedBackendId]
  );
  return normalizedBackendId;
}

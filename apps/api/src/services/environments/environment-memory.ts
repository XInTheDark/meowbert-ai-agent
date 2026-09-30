import { DEFAULT_MEMORY_ENABLED } from "@meowbert/shared";
import { query } from "../../lib/db.js";

export async function isEnvironmentMemoryEnabled(environmentId: string): Promise<boolean> {
  const result = await query<{ memory_enabled: boolean }>(
    `SELECT COALESCE(ws.memory_enabled, ${DEFAULT_MEMORY_ENABLED}) AS memory_enabled
       FROM environments e
       LEFT JOIN workspace_settings ws ON ws.workspace_id = e.workspace_id
      WHERE e.id = $1`,
    [environmentId]
  );

  return result.rows[0]?.memory_enabled ?? DEFAULT_MEMORY_ENABLED;
}

export function buildDefaultConnectorToolOptions(memoryEnabled: boolean): {
  webSearch: true;
  memorySearch?: true;
  scheduleTask: true;
} {
  if (memoryEnabled) {
    return {
      webSearch: true,
      memorySearch: true,
      scheduleTask: true
    };
  }

  return {
    webSearch: true,
    scheduleTask: true
  };
}

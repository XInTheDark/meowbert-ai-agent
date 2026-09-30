import { query } from "../../lib/db.js";

export async function listActiveConnectorEnvironments(
  workspaceId: string
): Promise<Array<{ id: string; name: string }>> {
  const envRes = await query<{ id: string; name: string }>(
    `SELECT id, name
       FROM environments
      WHERE workspace_id = $1
        AND status = 'active'
      ORDER BY created_at ASC`,
    [workspaceId]
  );

  return envRes.rows;
}

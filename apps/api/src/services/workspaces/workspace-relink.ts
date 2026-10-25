import { withTransaction } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import { normalizeWorkspaceFileHost } from "@meowbert/shared";

export async function requestWorkspaceRelink(workspaceId: string, deviceId: string, userId: string) {
  if (!config.localExecution.enabled) throw Object.assign(new Error("Local execution is disabled."), { statusCode: 400 });
  return withTransaction(async (client) => {
    const workspace = await client.query<{ file_host: unknown; storage_backend_id: string }>(
      "SELECT w.file_host, w.storage_backend_id FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id WHERE w.id = $1 AND wm.user_id = $2 AND wm.role = 'owner' FOR UPDATE OF w", [workspaceId, userId]
    );
    if (!workspace.rows[0]) throw Object.assign(new Error("Workspace not found"), { statusCode: 404 });
    const host = normalizeWorkspaceFileHost(workspace.rows[0].file_host, workspace.rows[0].storage_backend_id);
    if (host.kind !== "device") throw Object.assign(new Error("Server workspaces cannot be relinked to a device."), { statusCode: 400 });
    const device = await client.query("SELECT id FROM devices WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL FOR UPDATE", [deviceId, userId]);
    if (!device.rowCount) throw Object.assign(new Error("The selected device is unavailable."), { statusCode: 400 });
    if (host.deviceId === deviceId) return { pending: false, deviceId };
    const current = await client.query<{ new_device_id: string; eligible_at: string }>("SELECT new_device_id, eligible_at::text FROM workspace_device_relinks WHERE workspace_id = $1", [workspaceId]);
    if (current.rows[0]) {
      if (current.rows[0].new_device_id !== deviceId) throw Object.assign(new Error("This workspace is already being relinked."), { statusCode: 409 });
      return { pending: true, deviceId, readyAt: current.rows[0].eligible_at };
    }
    const relink = await client.query<{ eligible_at: string }>(
      "INSERT INTO workspace_device_relinks (workspace_id, old_device_id, new_device_id) VALUES ($1, $2, $3) RETURNING eligible_at::text", [workspaceId, host.deviceId, deviceId]
    );
    await client.query("UPDATE task_run_dispatches SET lease_epoch = lease_epoch + 1, updated_at = now() WHERE workspace_id = $1 AND queue_state = 'running'", [workspaceId]);
    return { pending: true, deviceId, readyAt: relink.rows[0].eligible_at };
  });
}

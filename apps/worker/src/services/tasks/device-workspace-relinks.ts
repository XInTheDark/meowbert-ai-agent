import { query, withTransaction } from "../../lib/db.js";

/** Reassignment is delayed beyond the old device's full fencing/reclaim window. */
export async function finishWorkspaceRelinksOnce(): Promise<void> {
  await withTransaction(async (client) => {
    const relinks = await client.query<{ workspace_id: string; old_device_id: string; new_device_id: string }>(
      "SELECT r.* FROM workspace_device_relinks r JOIN devices dv ON dv.id = r.new_device_id AND dv.revoked_at IS NULL WHERE r.eligible_at <= now() ORDER BY r.eligible_at LIMIT 10 FOR UPDATE OF r SKIP LOCKED"
    );
    for (const relink of relinks.rows) {
      const updated = await client.query(
        "UPDATE workspaces SET file_host = jsonb_build_object('kind', 'device', 'deviceId', $2::text), updated_at = now() WHERE id = $1 AND file_host->>'deviceId' = $3::text RETURNING id",
        [relink.workspace_id, relink.new_device_id, relink.old_device_id]
      );
      if (!updated.rowCount) continue;
      await client.query("UPDATE tasks SET execution_target = jsonb_set(execution_target, '{deviceId}', to_jsonb($2::text)) WHERE workspace_id = $1", [relink.workspace_id, relink.new_device_id]);
      await client.query(
        "UPDATE task_run_dispatches d SET payload_json = jsonb_set(d.payload_json, '{executionTarget,deviceId}', to_jsonb($2::text)), queue_state = 'pending', admitted_at = NULL, lease_device_id = NULL, lease_holder = NULL, lease_expires_at = NULL, lease_api_url = NULL, lease_epoch = d.lease_epoch + 1, started_at = NULL, pending_reason = NULL, storage_retry_at = NULL, eligible_at = now(), updated_at = now() FROM tasks t, task_runs r WHERE d.workspace_id = $1 AND d.task_id = t.id AND d.run_id = r.id AND r.ended_at IS NULL AND NOT t.cancellation_requested AND t.trashed_at IS NULL AND d.queue_state IN ('pending', 'admitted', 'running')",
        [relink.workspace_id, relink.new_device_id]
      );
      await client.query("UPDATE tasks t SET status = 'queued', updated_at = now() FROM task_run_dispatches d WHERE d.workspace_id = $1 AND d.task_id = t.id AND d.queue_state = 'pending' AND t.status IN ('starting', 'running') AND NOT t.cancellation_requested AND t.trashed_at IS NULL", [relink.workspace_id]);
      await client.query("INSERT INTO device_file_tombstones (device_id, workspace_id, kind, target_id, relative_path) VALUES ($1, $2, 'scratch', $2, '')", [relink.old_device_id, relink.workspace_id]);
      await client.query("DELETE FROM workspace_device_relinks WHERE workspace_id = $1", [relink.workspace_id]);
    }
  });
  await query("DELETE FROM device_file_tombstones WHERE acked_at < now() - interval '30 days'");
}

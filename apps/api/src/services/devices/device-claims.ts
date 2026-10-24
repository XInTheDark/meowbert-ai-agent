import { withTransaction } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import { RUN_API_PROTOCOL_VERSION, type TaskExecutionJob } from "@meowbert/shared";

export async function claimLocalRun(input: { userId: string; deviceId: string; runId: string }): Promise<{ job: unknown } | null> {
  return withTransaction(async (client) => {
    await client.query("SELECT id FROM devices WHERE id = $1 AND user_id = $2 FOR UPDATE", [input.deviceId, input.userId]);
    const result = await client.query<{ payload_json: TaskExecutionJob }>(
      `UPDATE task_run_dispatches d
          SET queue_state = 'running',
              lease_device_id = $2,
              started_at = COALESCE(started_at, now()),
              pending_reason = NULL,
              storage_retry_at = NULL,
              updated_at = now()
        FROM devices dv
       WHERE d.run_id = $1
         AND dv.id = $2
         AND dv.user_id = $3
         AND dv.revoked_at IS NULL
         AND dv.stream_expires_at > now()
         AND dv.last_seen_at > now() - interval '30 seconds'
         AND ((dv.platform = 'darwin' AND dv.architecture = 'arm64')
           OR (dv.platform = 'win32' AND dv.architecture IN ('x64', 'arm64')))
         AND dv.capabilities_json->>'dockerReady' = 'true'
         AND dv.capabilities_json->>'sandboxImageReady' = 'true'
         AND dv.capabilities_json->>'executorSupported' = 'true'
         AND dv.capabilities_json->>'protocolVersion' = $4::text
         AND ((SELECT sandbox_image_digest FROM platform_settings WHERE id = 1) IS NULL
           OR dv.capabilities_json->>'sandboxImageDigest' = (SELECT sandbox_image_digest FROM platform_settings WHERE id = 1))
         AND (SELECT count(*) FROM task_run_dispatches active WHERE active.lease_device_id = dv.id AND active.queue_state = 'running') < dv.max_concurrent_runs
         AND EXISTS (
           SELECT 1 FROM workspaces w WHERE w.id = d.workspace_id
             AND jsonb_typeof(dv.verified_roots_json->w.storage_backend_id) = 'string'
         )
         AND EXISTS (SELECT 1 FROM task_runs tr JOIN tasks t ON t.id = tr.task_id
           WHERE tr.id = d.run_id AND tr.ended_at IS NULL AND NOT t.cancellation_requested AND t.trashed_at IS NULL)
         AND d.queue_state = 'admitted'
         AND d.lease_device_id IS NULL
         AND (d.payload_json->'executionTarget'->>'kind') = 'local'
         AND (d.payload_json->'executionTarget'->>'deviceId') = $2::text
       RETURNING d.payload_json`,
      [input.runId, input.deviceId, input.userId, String(RUN_API_PROTOCOL_VERSION)]
    );
    const row = result.rows[0];
    if (row) await client.query(
      `UPDATE tasks t SET device_facts = jsonb_build_object('deviceId', dv.id, 'name', dv.name,
        'platform', dv.platform, 'architecture', dv.architecture, 'executorVersion', dv.executor_version,
        'sandboxImageDigest', dv.capabilities_json->>'sandboxImageDigest')
        FROM devices dv, task_run_dispatches d WHERE dv.id = $2 AND d.run_id = $1 AND t.id = d.task_id`,
      [input.runId, input.deviceId]
    );
    return row ? { job: row.payload_json } : null;
  });
}

export function resolveWorkerRunApiUrl(): string | null {
  return config.runApi?.url?.replace(/\/+$/, "") ?? null;
}

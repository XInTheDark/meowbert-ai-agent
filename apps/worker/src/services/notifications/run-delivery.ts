import { query, withConnection } from "../../lib/db.js";
import { emitRunNotifications } from "../agent/notifications.js";
import type { RunDeliveryChannel, RunDeliveryInput } from "./run-delivery-types.js";

function deliveryChannels(input: RunDeliveryInput): RunDeliveryChannel[] {
  const channels: RunDeliveryChannel[] = ["web"];
  if (!input.notificationRequested) return channels;
  if (input.workspaceId && input.environmentId) channels.push("push");
  if (input.connectorContextId) channels.push("telegram", "discord", "github", "email");
  return channels;
}

interface PendingDelivery {
  payload_json: RunDeliveryInput;
  delivered_channels: RunDeliveryChannel[];
}

export async function deliverPendingRun(runId: string): Promise<void> {
  await withConnection(async (client) => {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 116)) AS acquired", [runId]
    );
    if (!lock.rows[0]?.acquired) return;
    try {
      const result = await client.query<PendingDelivery>(
        `SELECT payload_json, delivered_channels FROM task_run_deliveries
          WHERE run_id = $1 AND completed_at IS NULL AND next_attempt_at <= now()`, [runId]
      );
      const row = result.rows[0];
      if (!row) return;
      const failures: string[] = [];
      for (const channel of deliveryChannels(row.payload_json)) {
        if (row.delivered_channels.includes(channel)) continue;
        try {
          await emitRunNotifications(row.payload_json, channel);
        } catch (error) {
          failures.push(`${channel}: ${String(error)}`);
          continue;
        }
        await client.query(
          `UPDATE task_run_deliveries SET delivered_channels = array_append(delivered_channels, $2)
            WHERE run_id = $1`, [runId, channel]
        );
      }
      if (failures.length > 0) throw new Error(failures.join("; "));
      await client.query(
        `UPDATE task_run_deliveries SET completed_at = now(), payload_json = '{}'::jsonb, last_error = NULL
          WHERE run_id = $1`, [runId]
      );
    } catch (error) {
      await client.query(
        `UPDATE task_run_deliveries SET attempts = attempts + 1, last_error = $2,
                next_attempt_at = now() + make_interval(secs => LEAST(3600, 30 * power(2, LEAST(attempts, 7)))::int)
          WHERE run_id = $1`, [runId, String(error).slice(0, 1000)]
      );
      console.warn(`Run delivery deferred for ${runId}`, error);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 116))", [runId]);
    }
  });
}

export async function deliverPendingRuns(): Promise<number> {
  const result = await query<{ run_id: string }>(
    `SELECT run_id FROM task_run_deliveries WHERE completed_at IS NULL AND next_attempt_at <= now()
      ORDER BY next_attempt_at, run_id LIMIT 20`
  );
  for (const row of result.rows) await deliverPendingRun(row.run_id);
  return result.rows.length;
}

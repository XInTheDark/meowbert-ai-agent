import { query, withTransaction } from "../../lib/db.js";
import { getUserUsageHeadroom } from "../tasks/subscription-usage.js";
import type { OperationBegin, RunApiStores, StoredOperationResponse } from "./stores.js";

// A reservation whose request never settled (its worker died) stops counting after this long.
const STALE_RESERVATION_INTERVAL = "1 hour";

const leases: RunApiStores["leases"] = {
  async releaseForStorage({ runId, epoch }) {
    return withTransaction(async (client) => {
      const result = await client.query<{ task_id: string }>(
        `UPDATE task_run_dispatches d
            SET queue_state = 'pending', pending_reason = 'waiting_for_storage',
                admitted_at = NULL, started_at = NULL, storage_retry_at = now() + interval '30 seconds',
                lease_holder = NULL, lease_device_id = NULL, lease_api_url = NULL, lease_expires_at = NULL,
                updated_at = now()
          WHERE run_id = $1 AND lease_epoch = $2 AND lease_holder LIKE 'device:%'
            AND queue_state = 'running' AND lease_expires_at > now()
            AND EXISTS (SELECT 1 FROM task_runs tr JOIN tasks t ON t.id = tr.task_id
              WHERE tr.id = d.run_id AND tr.ended_at IS NULL AND NOT t.cancellation_requested AND t.trashed_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM task_runs newer WHERE newer.task_id = tr.task_id AND newer.attempt_no > tr.attempt_no))
          RETURNING task_id`, [runId, epoch]
      );
      if (!result.rows[0]) return false;
      await client.query(
        "UPDATE tasks SET status = 'queued', updated_at = now() WHERE id = $1 AND NOT cancellation_requested AND status IN ('starting', 'running', 'queued')",
        [result.rows[0].task_id]
      );
      return true;
    });
  },
  async claim({ runId, holder, apiUrl, ttlMs }) {
    const result = await query<{ lease_epoch: number }>(
      `UPDATE task_run_dispatches
          SET lease_epoch = lease_epoch + 1,
              lease_holder = $2,
              lease_api_url = $3,
              lease_expires_at = now() + ($4::double precision * interval '1 millisecond'),
              updated_at = now()
        WHERE run_id = $1
          AND queue_state IN ('admitted', 'running')
          AND (lease_expires_at IS NULL OR lease_expires_at < now() - interval '30 seconds')
        RETURNING lease_epoch`,
      [runId, holder, apiUrl, ttlMs]
    );
    const row = result.rows[0];
    return row ? { epoch: row.lease_epoch } : null;
  },
  async renew({ runId, epoch, ttlMs }) {
    const result = await query(
      `UPDATE task_run_dispatches
          SET lease_expires_at = now() + ($3::double precision * interval '1 millisecond')
        WHERE run_id = $1
          AND lease_epoch = $2
          AND lease_expires_at > now()
          AND queue_state IN ('admitted', 'running')`,
      [runId, epoch, ttlMs]
    );
    return (result.rowCount ?? 0) > 0;
  },
  async currentEpoch(runId) {
    const result = await query<{ lease_epoch: number }>(
      "SELECT lease_epoch FROM task_run_dispatches WHERE run_id = $1",
      [runId]
    );
    return result.rows[0]?.lease_epoch ?? null;
  },
  async release({ runId, epoch }) {
    await query(
      `UPDATE task_run_dispatches
          SET lease_holder = NULL, lease_api_url = NULL, lease_expires_at = NULL
        WHERE run_id = $1 AND lease_epoch = $2`,
      [runId, epoch]
    );
  }
};

const operations: RunApiStores["operations"] = {
  async begin({ runId, operationId, requestHash }): Promise<OperationBegin> {
    const inserted = await query(
      `INSERT INTO run_api_operations (run_id, operation_id, request_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (run_id, operation_id) DO NOTHING`,
      [runId, operationId, requestHash]
    );
    if ((inserted.rowCount ?? 0) > 0) {
      return { state: "new" };
    }
    const existing = await query<{ request_hash: string; response_json: StoredOperationResponse | null }>(
      "SELECT request_hash, response_json FROM run_api_operations WHERE run_id = $1 AND operation_id = $2",
      [runId, operationId]
    );
    const row = existing.rows[0];
    if (!row || row.request_hash !== requestHash) return { state: "conflict" };
    return row.response_json ? { state: "done", response: row.response_json } : { state: "pending" };
  },
  async finish({ runId, operationId, response }) {
    await query(
      `UPDATE run_api_operations
          SET response_json = $3::jsonb, finished_at = now()
        WHERE run_id = $1 AND operation_id = $2`,
      [runId, operationId, JSON.stringify(response)]
    );
  }
};

const reservations: RunApiStores["reservations"] = {
  async reserve({ userId, runId, weightedTokens }) {
    return withTransaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
      const headroom = await getUserUsageHeadroom(userId);
      if (headroom !== null) {
        const held = await client.query<{ total: string }>(
          `SELECT COALESCE(SUM(weighted_tokens), 0)::text AS total
             FROM user_usage_reservations
            WHERE user_id = $1
              AND created_at > now() - interval '${STALE_RESERVATION_INTERVAL}'`,
          [userId]
        );
        if (Number(held.rows[0]?.total ?? 0) + weightedTokens > headroom) return null;
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO user_usage_reservations (user_id, run_id, weighted_tokens)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [userId, runId, weightedTokens]
      );
      return { id: result.rows[0].id };
    });
  },
  async release(reservationId) {
    await query("DELETE FROM user_usage_reservations WHERE id = $1", [reservationId]);
  }
};

// Server-side appends (subagent mail, swarm notes) can move a run's branch on between its own
// appends, so the walk covers a few of them.
const MAX_ANCESTOR_DEPTH = 64;

const messages: RunApiStores["messages"] = {
  async isAncestor({ taskId, ancestorId, messageId }) {
    const result = await query<{ found: boolean }>(
      `WITH RECURSIVE branch(id, parent_message_id, depth) AS (
         SELECT id, parent_message_id, 0 FROM task_messages WHERE id = $2 AND task_id = $1
         UNION ALL
         SELECT m.id, m.parent_message_id, b.depth + 1
           FROM task_messages m
           JOIN branch b ON m.id = b.parent_message_id
          WHERE m.task_id = $1 AND b.depth < $4
       )
       SELECT EXISTS (
         SELECT 1 FROM branch WHERE ($3::uuid IS NULL AND parent_message_id IS NULL) OR id = $3::uuid
       ) AS found`,
      [taskId, messageId, ancestorId, MAX_ANCESTOR_DEPTH]
    );
    return result.rows[0]?.found === true;
  }
};

export const sqlRunApiStores: RunApiStores = { leases, operations, reservations, messages };

// Operation records only need to outlive their run's retries.
export async function pruneRunApiRecords(): Promise<void> {
  await query("DELETE FROM run_api_operations WHERE created_at < now() - interval '1 day'");
  await query(`DELETE FROM user_usage_reservations WHERE created_at < now() - interval '${STALE_RESERVATION_INTERVAL}'`);
}

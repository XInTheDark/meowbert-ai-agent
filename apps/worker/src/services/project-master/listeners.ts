import { query, withTransaction } from "../../lib/db.js";

export interface ListenerTarget {
  masterTaskId: string;
  environmentId: string;
}

// Only top-level, visible tasks in the Master's own project can be listened to.
async function filterListenableTaskIds(target: ListenerTarget, taskIds: string[]): Promise<string[]> {
  const result = await query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE id = ANY($1::uuid[])
        AND id <> $2
        AND environment_id = $3
        AND parent_task_id IS NULL
        AND workflow_parent_task_id IS NULL
        AND is_hidden = false
        AND is_incognito = false`,
    [taskIds, target.masterTaskId, target.environmentId]
  );
  return result.rows.map((row) => row.id);
}

export async function setTaskListening(target: ListenerTarget, taskIds: string[], listen: boolean): Promise<string[]> {
  const listenableIds = await filterListenableTaskIds(target, [...new Set(taskIds)]);
  const missingIds = taskIds.filter((taskId) => !listenableIds.includes(taskId));
  if (missingIds.length > 0) {
    throw new Error(`Task not found in this project: ${missingIds.join(", ")}`);
  }

  if (listen) {
    await query(
      `INSERT INTO project_master_listeners (task_id, master_task_id)
       SELECT unnest($1::uuid[]), $2
       ON CONFLICT (task_id) DO UPDATE SET master_task_id = EXCLUDED.master_task_id`,
      [listenableIds, target.masterTaskId]
    );
  } else {
    await query(
      "DELETE FROM project_master_listeners WHERE task_id = ANY($1::uuid[]) AND master_task_id = $2",
      [listenableIds, target.masterTaskId]
    );
  }
  return listenableIds;
}

// A newly created task can settle before the listener row lands; record that outcome too.
export async function listenToNewTask(target: ListenerTarget, taskId: string): Promise<void> {
  await withTransaction(async (client) => {
    const task = await client.query<{ status: string; latest_run_id: string | null }>(
      `SELECT t.status,
              (SELECT id FROM task_runs WHERE task_id = t.id ORDER BY attempt_no DESC LIMIT 1) AS latest_run_id
         FROM tasks t
        WHERE t.id = $1
        FOR UPDATE`,
      [taskId]
    );
    await client.query(
      `INSERT INTO project_master_listeners (task_id, master_task_id) VALUES ($1, $2)
       ON CONFLICT (task_id) DO UPDATE SET master_task_id = EXCLUDED.master_task_id`,
      [taskId, target.masterTaskId]
    );
    const row = task.rows[0];
    if (row && ["succeeded", "failed", "cancelled", "awaiting_input"].includes(row.status) && row.latest_run_id) {
      await client.query(
        `INSERT INTO project_master_reports (master_task_id, task_id, run_id, status, delivery_key)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (delivery_key) DO NOTHING`,
        [target.masterTaskId, taskId, row.latest_run_id, row.status, `report:${taskId}:${row.latest_run_id}:${row.status}`]
      );
    }
  });
}

export async function loadListenedTaskIds(masterTaskId: string, taskIds: string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  const result = await query<{ task_id: string }>(
    "SELECT task_id FROM project_master_listeners WHERE master_task_id = $1 AND task_id = ANY($2::uuid[])",
    [masterTaskId, taskIds]
  );
  return new Set(result.rows.map((row) => row.task_id));
}

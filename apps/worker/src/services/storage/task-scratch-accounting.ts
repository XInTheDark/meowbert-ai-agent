import { XfsProjectQuotaManager } from "@meowbert/shared";
import type { PoolClient } from "pg";
import { config } from "../../lib/config.js";

// Project IDs account for each task independently; the backing image supplies the hard ceiling.
export async function assignTaskScratchProject(client: PoolClient, taskId: string, directory: string): Promise<void> {
  const quota = config.runtime.taskScratch.xfsProjectQuota;
  if (!quota) return;
  const result = await client.query<{ project_id: number }>(
    "SELECT COALESCE(scratch_project_id, nextval('task_scratch_project_id_seq'))::int AS project_id FROM tasks WHERE id = $1",
    [taskId]
  );
  const projectId = result.rows[0].project_id;
  await new XfsProjectQuotaManager().assignEmptyProject({ ...quota, directory, projectId });
  await client.query("UPDATE tasks SET scratch_project_id = $2 WHERE id = $1", [taskId, projectId]);
}

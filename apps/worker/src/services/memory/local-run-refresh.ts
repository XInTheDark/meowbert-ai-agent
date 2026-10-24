import { query } from "../../lib/db.js";
import { resolveTaskWorkspaceRoot } from "../workspaces/workspace-storage.js";
import { syncWorkspaceMemoryNow } from "./watcher.js";
import { readMemorySyncStatus } from "./storage.js";

export async function refreshLocalRunMemoryOnce(): Promise<void> {
  const result = await query<{ run_id: string; workspace_id: string; delay_seconds: number; root_path: string }>(
    `WITH due AS (SELECT run_id, delay_seconds FROM local_run_memory_refreshes WHERE due_at <= now()
       ORDER BY due_at LIMIT 10 FOR UPDATE SKIP LOCKED),
     claimed AS (UPDATE local_run_memory_refreshes r SET due_at = now() + interval '1 minute'
       FROM due WHERE r.run_id = due.run_id AND r.delay_seconds = due.delay_seconds RETURNING r.*)
     SELECT r.*, w.root_path FROM claimed r JOIN workspaces w ON w.id = r.workspace_id`
  );
  for (const refresh of result.rows) {
    try {
      const root = await resolveTaskWorkspaceRoot({ workspaceId: refresh.workspace_id, rootPath: refresh.root_path });
      await syncWorkspaceMemoryNow(root);
      const status = await readMemorySyncStatus(root);
      if (status.state !== "ready") throw new Error(status.error ?? "Workspace memory has not finished indexing.");
      await query("DELETE FROM local_run_memory_refreshes WHERE run_id = $1 AND delay_seconds = $2", [refresh.run_id, refresh.delay_seconds]);
    } catch (error) { console.warn("Local run memory refresh will retry", error); }
  }
}

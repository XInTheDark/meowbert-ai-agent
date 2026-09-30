import path from "node:path";
import { isProjectContextPath } from "@meowbert/shared/project-context";
import { query } from "../../lib/db.js";
import type { TaskLiveSyncFileSummary } from "../agent/live-sync-types.js";

function normalizeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  const resolved = path.posix.normalize(normalized);
  if (!resolved || resolved === "." || resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw new Error("Live sync path must stay within the task filesystem.");
  }
  return resolved;
}

export async function listTaskLiveSyncFilesForWorker(input: {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  taskRootPath: string;
}): Promise<TaskLiveSyncFileSummary[]> {
  const normalizedTaskRoot = normalizeRelativePath(input.taskRootPath);
  const result = await query<{
    id: string;
    provider: TaskLiveSyncFileSummary["provider"];
    source_id: string;
    link_kind: "file" | "folder";
    remote_name: string;
    remote_web_url: string | null;
    local_relative_path: string;
    last_pulled_at: string | null;
    last_pushed_at: string | null;
    last_sync_error: string | null;
  }>(
    `SELECT id,
            provider,
            source_id,
            link_kind,
            remote_name,
            remote_web_url,
            local_relative_path,
            last_pulled_at::text,
            last_pushed_at::text,
            last_sync_error
       FROM source_file_links
      WHERE workspace_id = $2
        AND (
          task_id = $1
          OR (
            environment_id = $3
            AND task_id IS NULL
            AND (local_relative_path = 'context' OR local_relative_path LIKE 'context/%')
          )
        )
      ORDER BY local_relative_path ASC`,
    [input.taskId, input.workspaceId, input.environmentId]
  );

  const seen = new Set<string>();
  const summaries = result.rows.flatMap((row) => {
    const normalizedLocalPath = normalizeRelativePath(row.local_relative_path);
    let taskRelativePath: string | null = null;
    if (
      normalizedLocalPath === normalizedTaskRoot
      || normalizedLocalPath.startsWith(`${normalizedTaskRoot}/`)
    ) {
      taskRelativePath = normalizedLocalPath.slice(normalizedTaskRoot.length).replace(/^\/+/, "");
    } else if (isProjectContextPath(normalizedLocalPath)) {
      taskRelativePath = normalizedLocalPath;
    }

    if (!taskRelativePath) {
      return [];
    }
    if (seen.has(taskRelativePath)) {
      return [];
    }
    seen.add(taskRelativePath);

    return [{
      id: row.id,
      provider: row.provider,
      sourceId: row.source_id,
      linkKind: row.link_kind,
      remoteName: row.remote_name,
      remoteWebUrl: row.remote_web_url,
      localRelativePath: normalizedLocalPath,
      taskRelativePath,
      lastPulledAt: row.last_pulled_at,
      lastPushedAt: row.last_pushed_at,
      lastSyncError: row.last_sync_error
    }];
  });

  return summaries;
}

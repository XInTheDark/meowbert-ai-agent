import type {
  TaskHistoryPagination,
  TaskHistorySearchInput,
  TaskHistorySearchPageRow
} from "@meowbert/shared/task-history-search";
import {
  finalizeTaskHistoryPage,
  resolveTaskHistoryOrderBy,
  resolveTaskHistorySortDirection
} from "@meowbert/shared/task-history-search";
import { query } from "../../lib/db.js";

export async function listProjectTasks(input: {
  projectId: string;
  actorUserId: string;
  filters: TaskHistorySearchInput;
}): Promise<{ items: TaskHistorySearchPageRow[]; pagination: TaskHistoryPagination }> {
  const orderBySql = resolveTaskHistoryOrderBy(input.filters.sortBy);
  const sortDirectionSql = resolveTaskHistorySortDirection(input.filters.sortDir);
  const pageLimit = input.filters.pageSize + 1;
  const offset = (input.filters.page - 1) * input.filters.pageSize;
  const tasksRes = await query<TaskHistorySearchPageRow>(
    `WITH RECURSIVE folder_scope(id) AS (
        SELECT $7::uuid
         WHERE $8::text = 'folder'
           AND $7::uuid IS NOT NULL
        UNION ALL
        SELECT tf.id
          FROM task_folders tf
          JOIN folder_scope fs ON fs.id = tf.parent_folder_id
         WHERE tf.environment_id = $1
      )
      SELECT t.id,
             t.title,
             t.status,
             t.created_at,
             t.updated_at,
             t.completed_at,
             t.trashed_at,
             t.task_root_path,
             t.folder_id,
             t.folder_sort_order,
             (t.public_share_id IS NOT NULL) AS is_publicly_shared,
             CASE
               WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
               WHEN ts.task_id IS NULL THEN 'standard'
               WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
               ELSE ts.mode
             END AS task_type,
             ts.schedule_state,
             ts.next_run_at AS schedule_next_run_at,
             ts.timezone AS schedule_timezone,
             ts.repeat_cron AS schedule_repeat_cron
        FROM tasks t
        LEFT JOIN task_schedules ts ON ts.task_id = t.id
       WHERE t.environment_id = $1
         AND EXISTS (
           SELECT 1
             FROM workspace_members wm
            WHERE wm.workspace_id = t.workspace_id
              AND wm.user_id = $2
         )
         AND t.parent_task_id IS NULL
         AND t.workflow_parent_task_id IS NULL
         AND t.is_incognito = false
         AND t.is_hidden = false
         AND ($3::text[] IS NULL OR t.status = ANY($3::text[]))
         AND ($4::text[] IS NULL OR (
           CASE
             WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
             WHEN ts.task_id IS NULL THEN 'standard'
             WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
             ELSE ts.mode
           END
         ) = ANY($4::text[]))
         AND (
           CASE
             WHEN $5::text = 'active' THEN t.trashed_at IS NULL
             WHEN $5::text = 'trashed' THEN t.trashed_at IS NOT NULL
             ELSE true
           END
         )
         AND (
           $8::text = 'all'
           OR ($8::text = 'unfiled' AND t.folder_id IS NULL)
           OR ($8::text = 'folder' AND t.folder_id IN (SELECT id FROM folder_scope))
         )
       ORDER BY ${orderBySql} ${sortDirectionSql}, t.created_at DESC, t.id DESC
       LIMIT $6
      OFFSET $9`,
    [
      input.projectId,
      input.actorUserId,
      input.filters.status,
      input.filters.taskType,
      input.filters.scope,
      pageLimit,
      input.filters.folderId,
      input.filters.folderMode,
      offset
    ]
  );
  const page = finalizeTaskHistoryPage(tasksRes.rows, input.filters);
  const items = page.items.flatMap((task) => {
    if (
      task.id === null
      || task.status === null
      || task.created_at === null
      || task.updated_at === null
      || task.is_publicly_shared === null
      || task.task_type === null
    ) {
      return [];
    }

    return [task];
  });

  return {
    items,
    pagination: page.pagination
  };
}

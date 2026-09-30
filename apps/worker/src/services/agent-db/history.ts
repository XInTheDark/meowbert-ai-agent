import { Meilisearch } from "meilisearch";
import { query } from "../../lib/db.js";
import {
  type TaskHistorySearchPageRow
} from "@meowbert/shared/task-history-search";
import type {
  TaskHistoryMessage,
  TaskHistorySearchInput,
  TaskHistorySearchResult,
  TaskHistoryResult
} from "../agent/types.js";
import { asText } from "../agent/utils.js";
import { ensureTaskHistoryWarm } from "../tasks/task-history.js";
import { loadTaskOutputFiles } from "./task-output-files.js";
import { config } from "../../lib/config.js";

interface TaskSearchHit {
  id: string;
}

interface TaskSearchResponse {
  hits: TaskSearchHit[];
  page?: number;
  hitsPerPage?: number;
  totalHits?: number;
  totalPages?: number;
}

function createTaskSearchClient(): Meilisearch | null {
  const meilisearch = config.search?.meilisearch;
  if (!meilisearch?.host) {
    return null;
  }

  return new Meilisearch({
    host: meilisearch.host,
    apiKey: meilisearch.apiKey
  });
}

function quoteFilterValue(value: string): string {
  return JSON.stringify(value);
}

function buildInFilter(attribute: string, values: string[] | null): string | null {
  if (!values || values.length === 0) {
    return null;
  }

  return `${attribute} IN [${values.map(quoteFilterValue).join(", ")}]`;
}

function resolveTaskSearchSort(filters: TaskHistorySearchInput): string[] | undefined {
  if (filters.sortBy === "relevance") {
    return undefined;
  }

  const direction = filters.sortDir;
  if (filters.sortBy === "created_at") {
    return [`createdAtMs:${direction}`];
  }
  if (filters.sortBy === "title") {
    return [`titleSort:${direction}`, "createdAtMs:desc"];
  }
  if (filters.sortBy === "status") {
    return [`status:${direction}`, "createdAtMs:desc"];
  }
  return [`updatedAtMs:${direction}`, "createdAtMs:desc"];
}

function buildTaskSearchFilters(input: {
  currentTaskId: string;
  environmentId: string;
  filters: TaskHistorySearchInput;
}): string[] {
  const filterParts = [
    `projectId = ${quoteFilterValue(input.environmentId)}`,
    `id != ${quoteFilterValue(input.currentTaskId)}`
  ];
  const statusFilter = buildInFilter("status", input.filters.status);
  const taskTypeFilter = buildInFilter("taskType", input.filters.taskType);

  if (input.filters.scope !== "all") {
    filterParts.push(`scope = ${quoteFilterValue(input.filters.scope)}`);
  }
  if (statusFilter) {
    filterParts.push(statusFilter);
  }
  if (taskTypeFilter) {
    filterParts.push(taskTypeFilter);
  }
  if (input.filters.folderMode === "unfiled") {
    filterParts.push("isUnfiled = true");
  } else if (input.filters.folderMode === "folder" && input.filters.folderId) {
    filterParts.push(`folderPathIds = ${quoteFilterValue(input.filters.folderId)}`);
  }

  return filterParts;
}

async function loadHistorySearchRows(taskIds: string[], environmentId: string): Promise<TaskHistorySearchPageRow[]> {
  if (taskIds.length === 0) {
    return [];
  }

  const taskRowsRes = await query<TaskHistorySearchPageRow>(
    `WITH requested AS (
        SELECT id, ord
          FROM unnest($1::uuid[]) WITH ORDINALITY AS req(id, ord)
      )
      SELECT t.id,
             t.title,
             t.status,
             t.created_at,
             t.updated_at,
             t.completed_at,
             t.trashed_at,
             t.task_root_path,
             NULL::boolean AS is_publicly_shared,
             CASE
               WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
               WHEN ts.task_id IS NULL THEN 'standard'
               WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
               ELSE ts.mode
             END AS task_type,
             ts.schedule_state,
             ts.next_run_at AS schedule_next_run_at,
             ts.timezone AS schedule_timezone,
             ts.repeat_cron AS schedule_repeat_cron,
             t.folder_id,
             t.folder_sort_order
        FROM requested req
        JOIN tasks t ON t.id = req.id
        LEFT JOIN task_schedules ts ON ts.task_id = t.id
       WHERE t.environment_id = $2
         AND t.parent_task_id IS NULL
         AND t.workflow_parent_task_id IS NULL
         AND t.is_incognito = false
       ORDER BY req.ord ASC`,
    [taskIds, environmentId]
  );
  return taskRowsRes.rows;
}

const LATEST_UPDATE_CHARS = 280;

function summarizeLatestUpdate(text: string | null | undefined): string | null {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > LATEST_UPDATE_CHARS ? `${normalized.slice(0, LATEST_UPDATE_CHARS)}...` : normalized;
}

async function loadLatestTaskUpdates(taskIds: string[]): Promise<Map<string, string | null>> {
  if (taskIds.length === 0) return new Map();
  const result = await query<{ task_id: string; text: string | null }>(
    `SELECT t.id AS task_id, latest.text
       FROM unnest($1::uuid[]) AS t(id)
       LEFT JOIN LATERAL (
         SELECT tm.content_json->>'text' AS text
           FROM task_messages tm
          WHERE tm.task_id = t.id
            AND tm.role = 'assistant'
            AND COALESCE(tm.content_json->>'text', '') <> ''
          ORDER BY tm.created_at DESC, tm.id DESC
          LIMIT 1
       ) latest ON true`,
    [taskIds]
  );
  return new Map(result.rows.map((row) => [row.task_id, summarizeLatestUpdate(row.text)]));
}

function mapHistorySearchRows(rows: TaskHistorySearchPageRow[], latestUpdates: Map<string, string | null>): TaskHistoryResult[] {
  return rows.flatMap((task) => {
    if (
      task.id === null
      || task.status === null
      || task.created_at === null
      || task.updated_at === null
      || task.task_type === null
    ) {
      return [];
    }

    return [{
      task_id: task.id,
      title: task.title,
      status: task.status,
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at,
      trashed_at: task.trashed_at,
      task_type: task.task_type,
      schedule_state: task.schedule_state,
      schedule_next_run_at: task.schedule_next_run_at,
      schedule_timezone: task.schedule_timezone,
      schedule_repeat_cron: task.schedule_repeat_cron,
      folder_id: task.folder_id,
      latest_update: latestUpdates.get(task.id) ?? null
    }];
  });
}

export async function queryTasks(
  currentTaskId: string,
  environmentId: string,
  filters: TaskHistorySearchInput
): Promise<TaskHistorySearchResult> {
  const client = createTaskSearchClient();
  if (!client) {
    return {
      tasks: [],
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        hasPreviousPage: filters.page > 1,
        hasNextPage: false,
        totalItems: 0,
        totalPages: 0
      }
    };
  }

  const index = client.index(config.search?.meilisearch.indexUid ?? "tasks");
  const sort = resolveTaskSearchSort(filters);
  const response = await index.search<TaskSearchHit>(filters.query ?? "", {
    page: filters.page,
    hitsPerPage: filters.pageSize,
    filter: buildTaskSearchFilters({ currentTaskId, environmentId, filters }),
    ...(sort ? { sort } : {}),
    attributesToRetrieve: ["id"]
  }) as TaskSearchResponse;
  const rows = await loadHistorySearchRows(response.hits.map((hit) => hit.id), environmentId);
  const latestUpdates = await loadLatestTaskUpdates(rows.flatMap((row) => row.id ? [row.id] : []));
  const page = response.page ?? filters.page;
  const totalPages = response.totalPages ?? null;

  return {
    tasks: mapHistorySearchRows(rows, latestUpdates),
    pagination: {
      page,
      pageSize: response.hitsPerPage ?? filters.pageSize,
      hasPreviousPage: page > 1,
      hasNextPage: totalPages === null ? false : page < totalPages,
      totalItems: response.totalHits ?? null,
      totalPages
    }
  };
}

async function loadHistoryTargetTask(targetTaskId: string, environmentId: string) {
  const taskRes = await query<{ id: string; title: string | null; status: string }>(
    `SELECT t.id, t.title, t.status
       FROM tasks t
      WHERE t.id = $1
        AND t.environment_id = $2
        AND t.trashed_at IS NULL
        AND t.is_incognito = false`,
    [targetTaskId, environmentId]
  );

  return taskRes.rows[0] ?? null;
}

async function loadTaskHistoryMessages(targetTaskId: string, maxMessages: number): Promise<TaskHistoryMessage[]> {
  const messagesRes = await query<{ role: string; content_json: Record<string, unknown>; created_at: string }>(
    `SELECT tm.role, tm.content_json, tm.created_at
       FROM task_messages tm
      WHERE tm.task_id = $1
        AND tm.role IN ('user', 'assistant')
      ORDER BY tm.created_at ASC
      LIMIT $2`,
    [targetTaskId, maxMessages]
  );

  return messagesRes.rows
    .map((row) => ({
      role: row.role,
      text: asText(row.content_json),
      created_at: row.created_at
    }))
    .filter((message) => message.text.trim().length > 0);
}

export async function viewTaskHistory(
  targetTaskId: string,
  environmentId: string,
  maxMessages: number
): Promise<{ task_id: string; title: string | null; status: string; files: string[]; messages: TaskHistoryMessage[] } | null> {
  const effectiveMax = Math.min(Math.max(maxMessages, 1), 50);
  const task = await loadHistoryTargetTask(targetTaskId, environmentId);
  if (!task) {
    return null;
  }
  await ensureTaskHistoryWarm(task.id);

  return {
    task_id: task.id,
    title: task.title,
    status: task.status,
    files: await loadTaskOutputFiles({ query }, task.id),
    messages: await loadTaskHistoryMessages(targetTaskId, effectiveMax)
  };
}

import type { QueryResultRow } from "pg";
import type { TaskHistorySearchInput } from "@meowbert/shared/task-history-search";
import { query } from "../../lib/db.js";
import { createMeilisearchClient, getTaskSearchIndexUid } from "./client.js";
import {
  TASK_SEARCH_HIGHLIGHT_POST_TAG,
  TASK_SEARCH_HIGHLIGHT_PRE_TAG,
  TASK_SEARCH_PREVIEW_LENGTH,
  type SearchGlobalTasksInput,
  type SearchProjectTasksInput,
  type SearchTasksOutput,
  type TaskSearchHit,
  type TaskSearchResultItem
} from "./types.js";

interface ProjectAccessRow extends QueryResultRow {
  id: string;
  workspace_id: string;
}

interface HydratedTaskSearchRow extends QueryResultRow {
  id: string | null;
  title: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  trashed_at: string | null;
  task_root_path: string | null;
  folder_id: string | null;
  folder_sort_order: number | string | null;
  is_publicly_shared: boolean | null;
  task_type: TaskSearchResultItem["task_type"];
  schedule_state: "active" | "paused" | "cancelled" | null;
  schedule_next_run_at: string | null;
  schedule_timezone: string | null;
  schedule_repeat_cron: string | null;
  workspace_id: string;
  workspace_name: string;
  project_id: string;
  project_name: string;
}

interface FiniteTaskSearchResponse {
  hits: TaskSearchHit[];
  page?: number;
  hitsPerPage?: number;
  totalHits?: number;
  totalPages?: number;
}

function quoteFilterValue(value: string): string {
  return JSON.stringify(value);
}

function buildInFilter(attribute: string, values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }

  return `${attribute} IN [${values.map(quoteFilterValue).join(", ")}]`;
}

function resolveSort(filters: TaskHistorySearchInput): string[] | undefined {
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
  filters: TaskHistorySearchInput;
  projectId?: string;
  workspaceIds?: string[];
}): string[] {
  const filterParts: string[] = [];

  if (input.projectId) {
    filterParts.push(`projectId = ${quoteFilterValue(input.projectId)}`);
  }

  const workspaceFilter = buildInFilter("workspaceId", input.workspaceIds ?? []);
  if (workspaceFilter) {
    filterParts.push(workspaceFilter);
  }

  if (input.filters.scope !== "all") {
    filterParts.push(`scope = ${quoteFilterValue(input.filters.scope)}`);
  }

  const statusFilter = buildInFilter("status", input.filters.status ?? []);
  if (statusFilter) {
    filterParts.push(statusFilter);
  }

  const taskTypeFilter = buildInFilter("taskType", input.filters.taskType ?? []);
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

function splitHighlightedText(rawValue: string): { text: string; highlight: boolean }[] {
  const segments: { text: string; highlight: boolean }[] = [];
  let remaining = rawValue;
  let highlighted = false;

  while (remaining.length > 0) {
    const nextStart = remaining.indexOf(TASK_SEARCH_HIGHLIGHT_PRE_TAG);
    const nextEnd = remaining.indexOf(TASK_SEARCH_HIGHLIGHT_POST_TAG);
    const nextTag = [nextStart, nextEnd].filter((value) => value >= 0).sort((a, b) => a - b)[0];

    if (nextTag === undefined) {
      segments.push({ text: remaining, highlight: highlighted });
      break;
    }

    if (nextTag > 0) {
      segments.push({ text: remaining.slice(0, nextTag), highlight: highlighted });
      remaining = remaining.slice(nextTag);
      continue;
    }

    if (remaining.startsWith(TASK_SEARCH_HIGHLIGHT_PRE_TAG)) {
      highlighted = true;
      remaining = remaining.slice(TASK_SEARCH_HIGHLIGHT_PRE_TAG.length);
      continue;
    }

    if (remaining.startsWith(TASK_SEARCH_HIGHLIGHT_POST_TAG)) {
      highlighted = false;
      remaining = remaining.slice(TASK_SEARCH_HIGHLIGHT_POST_TAG.length);
      continue;
    }

    segments.push({ text: remaining[0], highlight: highlighted });
    remaining = remaining.slice(1);
  }

  return segments.filter((segment) => segment.text.length > 0);
}

function capPreviewSegments(
  segments: { text: string; highlight: boolean }[],
  maxLength: number
): { text: string; highlight: boolean }[] {
  let remaining = maxLength;
  const capped: { text: string; highlight: boolean }[] = [];

  for (const segment of segments) {
    if (remaining <= 0) {
      break;
    }

    const text = segment.text.length > remaining ? `${segment.text.slice(0, Math.max(0, remaining - 1))}…` : segment.text;
    capped.push({ ...segment, text });
    remaining -= text.length;
  }

  return capped;
}

function buildPreview(hit: TaskSearchHit): TaskSearchResultItem["searchPreview"] {
  const formatted = hit._formatted ?? {};
  const candidate =
    typeof formatted.contentText === "string" && formatted.contentText.includes(TASK_SEARCH_HIGHLIGHT_PRE_TAG)
      ? formatted.contentText
      : typeof formatted.title === "string" && formatted.title.includes(TASK_SEARCH_HIGHLIGHT_PRE_TAG)
        ? formatted.title
        : typeof formatted.contentText === "string" && formatted.contentText.trim().length > 0
          ? formatted.contentText
          : null;

  if (!candidate) {
    return null;
  }

  return {
    segments: capPreviewSegments(splitHighlightedText(candidate), TASK_SEARCH_PREVIEW_LENGTH)
  };
}

async function resolveProjectAccess(projectId: string, actorUserId: string): Promise<ProjectAccessRow | null> {
  const result = await query<ProjectAccessRow>(
    `SELECT e.id, e.workspace_id
       FROM environments e
       JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
      WHERE e.id = $1
        AND wm.user_id = $2`,
    [projectId, actorUserId]
  );

  return result.rows[0] ?? null;
}

async function resolveAccessibleWorkspaceIds(
  actorUserId: string,
  requestedWorkspaceIds: string[] | null
): Promise<string[]> {
  const result = await query<{ workspace_id: string }>(
    `SELECT workspace_id
       FROM workspace_members
      WHERE user_id = $1
        AND ($2::uuid[] IS NULL OR workspace_id = ANY($2::uuid[]))
      ORDER BY workspace_id ASC`,
    [actorUserId, requestedWorkspaceIds]
  );

  return result.rows.map((row) => row.workspace_id);
}

async function hydrateTaskSearchRows(input: {
  taskIds: string[];
  actorUserId: string;
  projectId?: string;
  workspaceIds?: string[];
  filters: TaskHistorySearchInput;
  previewsByTaskId: Map<string, TaskSearchResultItem["searchPreview"]>;
}): Promise<TaskSearchResultItem[]> {
  if (input.taskIds.length === 0) {
    return [];
  }

  const result = await query<HydratedTaskSearchRow>(
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
             ts.repeat_cron AS schedule_repeat_cron,
             w.id AS workspace_id,
             w.name AS workspace_name,
             e.id AS project_id,
             e.name AS project_name
        FROM requested req
        JOIN tasks t ON t.id = req.id
        JOIN environments e ON e.id = t.environment_id
        JOIN workspaces w ON w.id = t.workspace_id
        JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
        LEFT JOIN task_schedules ts ON ts.task_id = t.id
       WHERE wm.user_id = $2
         AND ($3::uuid IS NULL OR t.environment_id = $3)
         AND ($4::uuid[] IS NULL OR t.workspace_id = ANY($4::uuid[]))
         AND t.parent_task_id IS NULL
         AND t.workflow_parent_task_id IS NULL
         AND t.is_incognito = false
         AND t.is_hidden = false
         AND ($5::text[] IS NULL OR t.status = ANY($5::text[]))
         AND (
           CASE
             WHEN $6::text = 'active' THEN t.trashed_at IS NULL
             WHEN $6::text = 'trashed' THEN t.trashed_at IS NOT NULL
             ELSE true
           END
         )
       ORDER BY req.ord ASC`,
    [
      input.taskIds,
      input.actorUserId,
      input.projectId ?? null,
      input.workspaceIds && input.workspaceIds.length > 0 ? input.workspaceIds : null,
      input.filters.status,
      input.filters.scope
    ]
  );

  return result.rows.flatMap((row) => {
    if (
      row.id === null
      || row.status === null
      || row.created_at === null
      || row.updated_at === null
      || row.is_publicly_shared === null
      || row.task_type === null
    ) {
      return [];
    }

    return [{
      ...row,
      searchPreview: input.previewsByTaskId.get(row.id) ?? null
    }];
  });
}

async function runTaskSearch(input: {
  actorUserId: string;
  filters: TaskHistorySearchInput;
  projectId?: string;
  workspaceIds?: string[];
}): Promise<SearchTasksOutput> {
  const client = createMeilisearchClient();
  if (!client) {
    throw new Error("Task search is not configured");
  }

  const index = client.index(getTaskSearchIndexUid());
  const includePreview = input.filters.includePreview;
  const sort = resolveSort(input.filters);
  const response = await index.search<TaskSearchHit>(input.filters.query ?? "", {
    page: input.filters.page,
    hitsPerPage: input.filters.pageSize,
    filter: buildTaskSearchFilters(input),
    ...(sort ? { sort } : {}),
    attributesToRetrieve: ["id"],
    ...(includePreview ? {
      attributesToHighlight: ["title", "contentText"],
      attributesToCrop: ["title", "contentText"],
      cropLength: 40,
      cropMarker: "…",
      highlightPreTag: TASK_SEARCH_HIGHLIGHT_PRE_TAG,
      highlightPostTag: TASK_SEARCH_HIGHLIGHT_POST_TAG
    } : {})
  }) as FiniteTaskSearchResponse;
  const hits = response.hits;
  const previewsByTaskId = new Map(
    hits.map((hit) => [hit.id, includePreview ? buildPreview(hit) : null])
  );
  const items = await hydrateTaskSearchRows({
    taskIds: hits.map((hit) => hit.id),
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    workspaceIds: input.workspaceIds,
    filters: input.filters,
    previewsByTaskId
  });

  return {
    items,
    pagination: {
      page: response.page ?? input.filters.page,
      pageSize: response.hitsPerPage ?? input.filters.pageSize,
      hasPreviousPage: (response.page ?? input.filters.page) > 1,
      hasNextPage: (response.page ?? input.filters.page) < (response.totalPages ?? input.filters.page),
      totalItems: response.totalHits ?? null,
      totalPages: response.totalPages ?? null
    }
  };
}

export async function searchProjectTasks(input: SearchProjectTasksInput): Promise<SearchTasksOutput> {
  const access = await resolveProjectAccess(input.projectId, input.actorUserId);
  if (!access) {
    return {
      items: [],
      pagination: {
        page: input.filters.page,
        pageSize: input.filters.pageSize,
        hasPreviousPage: input.filters.page > 1,
        hasNextPage: false,
        totalItems: 0,
        totalPages: 0
      }
    };
  }

  return runTaskSearch({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    workspaceIds: [access.workspace_id],
    filters: input.filters
  });
}

export async function searchGlobalTasks(input: SearchGlobalTasksInput): Promise<SearchTasksOutput> {
  const workspaceIds = await resolveAccessibleWorkspaceIds(input.actorUserId, input.workspaceIds);
  if (workspaceIds.length === 0) {
    return {
      items: [],
      pagination: {
        page: input.filters.page,
        pageSize: input.filters.pageSize,
        hasPreviousPage: input.filters.page > 1,
        hasNextPage: false,
        totalItems: 0,
        totalPages: 0
      }
    };
  }

  return runTaskSearch({
    actorUserId: input.actorUserId,
    workspaceIds,
    filters: input.filters
  });
}

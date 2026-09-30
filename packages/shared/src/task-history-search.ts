import { z } from "zod";
import type { TaskStatus } from "./types.js";

export const TASK_HISTORY_STATUS_VALUES = [
  "queued",
  "starting",
  "running",
  "awaiting_input",
  "succeeded",
  "failed",
  "cancelled"
] as const satisfies readonly TaskStatus[];
export const TASK_HISTORY_SCOPE_VALUES = ["active", "trashed", "all"] as const;
export const TASK_HISTORY_TASK_TYPE_VALUES = [
  "standard",
  "scheduled",
  "infinite",
  "timed",
  "long_horizon",
  "agent_swarm"
] as const;
export const TASK_HISTORY_SORT_BY_VALUES = ["relevance", "created_at", "updated_at", "title", "status"] as const;
export const TASK_HISTORY_SORT_DIR_VALUES = ["asc", "desc"] as const;
export const TASK_HISTORY_FOLDER_MODE_VALUES = ["all", "unfiled", "folder"] as const;

export type TaskHistoryStatusValue = (typeof TASK_HISTORY_STATUS_VALUES)[number];
export type TaskHistoryScope = (typeof TASK_HISTORY_SCOPE_VALUES)[number];
export type TaskHistoryTaskType = (typeof TASK_HISTORY_TASK_TYPE_VALUES)[number];
export type TaskHistoryConcreteTaskType = TaskHistoryTaskType;
export type TaskHistorySortBy = (typeof TASK_HISTORY_SORT_BY_VALUES)[number];
export type TaskHistorySortDir = (typeof TASK_HISTORY_SORT_DIR_VALUES)[number];
export type TaskHistoryFolderMode = (typeof TASK_HISTORY_FOLDER_MODE_VALUES)[number];

export const taskHistoryStatusSchema = z.enum(TASK_HISTORY_STATUS_VALUES);
export const taskHistoryScopeSchema = z.enum(TASK_HISTORY_SCOPE_VALUES);
export const taskHistoryTaskTypeSchema = z.enum(TASK_HISTORY_TASK_TYPE_VALUES);
export const taskHistorySortBySchema = z.enum(TASK_HISTORY_SORT_BY_VALUES);
export const taskHistorySortDirSchema = z.enum(TASK_HISTORY_SORT_DIR_VALUES);
export const taskHistoryFolderModeSchema = z.enum(TASK_HISTORY_FOLDER_MODE_VALUES);

export const DEFAULT_TASK_HISTORY_SCOPE: TaskHistoryScope = "active";
export const DEFAULT_TASK_HISTORY_TASK_TYPE: TaskHistoryTaskType[] | null = null;
export const DEFAULT_TASK_HISTORY_SORT_BY: TaskHistorySortBy = "relevance";
export const DEFAULT_TASK_HISTORY_SORT_DIR: TaskHistorySortDir = "desc";
export const DEFAULT_TASK_HISTORY_FOLDER_MODE: TaskHistoryFolderMode = "all";
export const DEFAULT_TASK_HISTORY_PAGE = 1;
export const DEFAULT_TASK_HISTORY_PAGE_SIZE = 25;
export const MAX_TASK_HISTORY_PAGE_SIZE = 100;

export interface TaskHistorySearchInput {
  query: string | null;
  status: TaskHistoryStatusValue[] | null;
  scope: TaskHistoryScope;
  taskType: TaskHistoryTaskType[] | null;
  sortBy: TaskHistorySortBy;
  sortDir: TaskHistorySortDir;
  folderMode: TaskHistoryFolderMode;
  folderId: string | null;
  includePreview: boolean;
  page: number;
  pageSize: number;
}

export interface TaskHistoryPagination {
  page: number;
  pageSize: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  totalItems: number | null;
  totalPages: number | null;
}

export interface TaskHistorySearchPageRow {
  id: string | null;
  title: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  trashed_at: string | null;
  task_root_path: string | null;
  is_publicly_shared: boolean | null;
  task_type: TaskHistoryConcreteTaskType | null;
  schedule_state: "active" | "paused" | "cancelled" | null;
  schedule_next_run_at: string | null;
  schedule_timezone: string | null;
  schedule_repeat_cron: string | null;
  folder_id: string | null;
  folder_sort_order: number | string | null;
}

export interface TaskSearchPreviewSegment {
  text: string;
  highlight: boolean;
}

export interface TaskSearchPreview {
  segments: TaskSearchPreviewSegment[];
}

export interface TaskHistorySearchDefaults {
  defaultPageSize?: number;
  defaultScope?: TaskHistoryScope;
  defaultTaskType?: TaskHistoryTaskType[] | null;
  defaultSortBy?: TaskHistorySortBy;
  defaultSortDir?: TaskHistorySortDir;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const floored = Math.floor(value);
    return floored >= 1 ? floored : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    const floored = Math.floor(parsed);
    return floored >= 1 ? floored : null;
  }

  return null;
}

function isTaskHistoryStatusValue(value: string): value is TaskHistoryStatusValue {
  return (TASK_HISTORY_STATUS_VALUES as readonly string[]).includes(value);
}

function isTaskHistoryScope(value: string): value is TaskHistoryScope {
  return (TASK_HISTORY_SCOPE_VALUES as readonly string[]).includes(value);
}

function isTaskHistoryTaskType(value: string): value is TaskHistoryTaskType {
  return (TASK_HISTORY_TASK_TYPE_VALUES as readonly string[]).includes(value);
}

function isTaskHistorySortBy(value: string): value is TaskHistorySortBy {
  return (TASK_HISTORY_SORT_BY_VALUES as readonly string[]).includes(value);
}

function isTaskHistorySortDir(value: string): value is TaskHistorySortDir {
  return (TASK_HISTORY_SORT_DIR_VALUES as readonly string[]).includes(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeTaskHistoryQuery(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBooleanQuery(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
}

function normalizeTaskHistoryFolder(value: unknown): Pick<TaskHistorySearchInput, "folderMode" | "folderId"> {
  if (typeof value !== "string") {
    return {
      folderMode: DEFAULT_TASK_HISTORY_FOLDER_MODE,
      folderId: null
    };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "all") {
    return {
      folderMode: "all",
      folderId: null
    };
  }

  if (trimmed === "unfiled") {
    return {
      folderMode: "unfiled",
      folderId: null
    };
  }

  if (isUuid(trimmed)) {
    return {
      folderMode: "folder",
      folderId: trimmed
    };
  }

  return {
    folderMode: DEFAULT_TASK_HISTORY_FOLDER_MODE,
    folderId: null
  };
}

export function normalizeTaskHistoryStatusList(value: unknown): TaskHistoryStatusValue[] | null {
  if (typeof value !== "string" && !Array.isArray(value)) {
    return null;
  }

  const rawValues = Array.isArray(value) ? value : [value];
  const seen = new Set<TaskHistoryStatusValue>();
  const normalized = rawValues
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
    .map((entry) => entry.trim())
    .filter((entry): entry is TaskHistoryStatusValue => entry.length > 0 && isTaskHistoryStatusValue(entry))
    .filter((entry) => {
      if (seen.has(entry)) {
        return false;
      }

      seen.add(entry);
      return true;
    });

  return normalized.length > 0 ? normalized : null;
}

export function normalizeTaskHistoryTaskTypeList(value: unknown): TaskHistoryTaskType[] | null {
  if (typeof value !== "string" && !Array.isArray(value)) {
    return null;
  }

  const rawValues = Array.isArray(value) ? value : [value];
  const seen = new Set<TaskHistoryTaskType>();
  const normalized = rawValues
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "all")
    .filter((entry): entry is TaskHistoryTaskType => isTaskHistoryTaskType(entry))
    .filter((entry) => {
      if (seen.has(entry)) {
        return false;
      }

      seen.add(entry);
      return true;
    });

  return normalized.length > 0 ? normalized : null;
}

export function normalizeTaskHistorySearchInput(
  input: {
    q?: unknown;
    query?: unknown;
    status?: unknown;
    scope?: unknown;
    taskType?: unknown;
    sortBy?: unknown;
    sortDir?: unknown;
    folderId?: unknown;
    includePreview?: unknown;
    page?: unknown;
    pageSize?: unknown;
    limit?: unknown;
  },
  defaults: TaskHistorySearchDefaults = {}
): TaskHistorySearchInput {
  const query = normalizeTaskHistoryQuery(input.q) ?? normalizeTaskHistoryQuery(input.query);
  const status = normalizeTaskHistoryStatusList(input.status);
  const taskType = normalizeTaskHistoryTaskTypeList(input.taskType) ?? defaults.defaultTaskType ?? DEFAULT_TASK_HISTORY_TASK_TYPE;
  const scope = typeof input.scope === "string" && isTaskHistoryScope(input.scope)
    ? input.scope
    : defaults.defaultScope ?? DEFAULT_TASK_HISTORY_SCOPE;
  const sortBy = typeof input.sortBy === "string" && isTaskHistorySortBy(input.sortBy)
    ? input.sortBy
    : defaults.defaultSortBy ?? DEFAULT_TASK_HISTORY_SORT_BY;
  const sortDir = typeof input.sortDir === "string" && isTaskHistorySortDir(input.sortDir)
    ? input.sortDir
    : defaults.defaultSortDir ?? DEFAULT_TASK_HISTORY_SORT_DIR;
  const folder = normalizeTaskHistoryFolder(input.folderId);
  const includePreview = normalizeBooleanQuery(input.includePreview, true);
  const page = parsePositiveInt(input.page) ?? DEFAULT_TASK_HISTORY_PAGE;
  const requestedPageSize = parsePositiveInt(input.pageSize) ?? parsePositiveInt(input.limit);
  const pageSize = Math.min(
    requestedPageSize ?? defaults.defaultPageSize ?? DEFAULT_TASK_HISTORY_PAGE_SIZE,
    MAX_TASK_HISTORY_PAGE_SIZE
  );

  return {
    query,
    status,
    scope,
    taskType,
    sortBy,
    sortDir,
    folderMode: folder.folderMode,
    folderId: folder.folderId,
    includePreview,
    page,
    pageSize
  };
}

export function createTaskHistorySearchQuerySchema(defaults: TaskHistorySearchDefaults = {}) {
  return z.object({
    q: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1).max(320).optional())
      .optional(),
    query: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1).max(320).optional())
      .optional(),
    status: z.preprocess(
      normalizeTaskHistoryStatusList,
      z.array(taskHistoryStatusSchema).max(TASK_HISTORY_STATUS_VALUES.length).nullable().optional()
    ),
    scope: taskHistoryScopeSchema.optional(),
    taskType: z.preprocess(
      normalizeTaskHistoryTaskTypeList,
      z.array(taskHistoryTaskTypeSchema).max(TASK_HISTORY_TASK_TYPE_VALUES.length).nullable().optional()
    ),
    sortBy: taskHistorySortBySchema.optional(),
    sortDir: taskHistorySortDirSchema.optional(),
    folderId: z.string().max(120).optional(),
    includePreview: z.preprocess((value) => normalizeBooleanQuery(value, true), z.boolean().optional()),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(MAX_TASK_HISTORY_PAGE_SIZE).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_TASK_HISTORY_PAGE_SIZE).optional()
  }).transform((value) => normalizeTaskHistorySearchInput(value, defaults));
}

export function buildTaskHistorySearchParams(filters: TaskHistorySearchInput): URLSearchParams {
  const searchParams = new URLSearchParams();

  if (filters.query) {
    searchParams.set("q", filters.query);
  }

  for (const status of filters.status ?? []) {
    searchParams.append("status", status);
  }

  if (filters.scope !== DEFAULT_TASK_HISTORY_SCOPE) {
    searchParams.set("scope", filters.scope);
  }

  for (const taskType of filters.taskType ?? []) {
    searchParams.append("taskType", taskType);
  }

  if (filters.sortBy !== DEFAULT_TASK_HISTORY_SORT_BY) {
    searchParams.set("sortBy", filters.sortBy);
  }

  if (filters.sortDir !== DEFAULT_TASK_HISTORY_SORT_DIR) {
    searchParams.set("sortDir", filters.sortDir);
  }

  if (filters.folderMode === "unfiled") {
    searchParams.set("folderId", "unfiled");
  } else if (filters.folderMode === "folder" && filters.folderId) {
    searchParams.set("folderId", filters.folderId);
  }

  if (filters.includePreview === false) {
    searchParams.set("includePreview", "false");
  }

  searchParams.set("page", String(filters.page));
  searchParams.set("pageSize", String(filters.pageSize));

  return searchParams;
}

export function resolveTaskHistoryOrderBy(sortBy: TaskHistorySortBy): string {
  if (sortBy === "updated_at") {
    return "updated_at";
  }

  if (sortBy === "title") {
    return "COALESCE(title, '')";
  }

  if (sortBy === "status") {
    return "status";
  }

  if (sortBy === "relevance") {
    return "updated_at";
  }

  return "created_at";
}

export function resolveTaskHistorySortDirection(sortDir: TaskHistorySortDir): "ASC" | "DESC" {
  return sortDir === "asc" ? "ASC" : "DESC";
}

export function finalizeTaskHistoryPage<T>(
  rows: T[],
  filters: Pick<TaskHistorySearchInput, "page" | "pageSize">
): { items: T[]; pagination: TaskHistoryPagination } {
  const hasNextPage = rows.length > filters.pageSize;

  return {
    items: hasNextPage ? rows.slice(0, filters.pageSize) : rows,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      hasPreviousPage: filters.page > 1,
      hasNextPage,
      totalItems: null,
      totalPages: null
    }
  };
}

export function extractTaskSearchableText(content: Record<string, unknown>): string {
  const parts: string[] = [];

  if (typeof content.text === "string") {
    parts.push(content.text);
  }
  if (typeof content.summary_markdown === "string") {
    parts.push(content.summary_markdown);
  }
  if (typeof content.output_text === "string") {
    parts.push(content.output_text);
  }
  if (parts.length > 0) {
    return parts.join("\n\n");
  }

  const responseItems = Array.isArray(content.response_items) ? content.response_items : [];
  for (const item of responseItems) {
    if (!isRecord(item)) {
      continue;
    }
    if (item.type === "output_text" && typeof item.text === "string") {
      parts.push(item.text);
      continue;
    }
    if (item.type === "message") {
      const itemContent = Array.isArray(item.content) ? item.content : [];
      for (const part of itemContent) {
        if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") {
          parts.push(part.text);
        }
      }
      continue;
    }
    if (item.type === "function_call" && item.name === "final_response" && typeof item.arguments === "string") {
      try {
        const parsed = JSON.parse(item.arguments);
        if (isRecord(parsed) && typeof parsed.response === "string") {
          parts.push(parsed.response);
        }
      } catch {
        // Ignore malformed tool-call arguments in search text extraction.
      }
    }
  }

  return parts.join("\n\n");
}

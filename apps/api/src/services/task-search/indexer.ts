import type { QueryResultRow } from "pg";
import { extractTaskSearchableText } from "@meowbert/shared/task-history-search";
import { query } from "../../lib/db.js";
import { createMeilisearchClient, getTaskSearchIndexUid } from "./client.js";
import type { TaskSearchDocument } from "./types.js";

const MAX_INDEXED_MESSAGES_PER_TASK = 100;
const MAX_INDEXED_CONTENT_CHARS = 1_000_000;
const MAX_INDEXING_TASKS_PER_CHUNK = 5;

interface TaskIndexRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  title: string | null;
  status: string;
  created_at: string | Date;
  updated_at: string | Date;
  trashed_at: string | Date | null;
  folder_id: string | null;
  parent_task_id: string | null;
  workflow_parent_task_id: string | null;
  is_incognito: boolean;
  is_hidden: boolean;
  task_type: TaskSearchDocument["taskType"];
}

interface TaskMessageIndexRow extends QueryResultRow {
  task_id: string;
  role: string;
  content_json: Record<string, unknown>;
}

interface TaskFolderIndexRow extends QueryResultRow {
  id: string;
  environment_id: string;
  parent_folder_id: string | null;
}

function toTimestampMs(value: string | Date): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildFolderPathIds(
  folderId: string | null,
  foldersById: Map<string, TaskFolderIndexRow>
): string[] {
  if (!folderId) {
    return [];
  }

  const pathIds: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    pathIds.unshift(currentId);
    currentId = foldersById.get(currentId)?.parent_folder_id ?? null;
  }

  return pathIds;
}

function appendCappedText(parts: string[], usedChars: number, nextText: string, maxChars: number): number {
  const separatorChars = parts.length > 0 ? 2 : 0;
  const remainingChars = maxChars - usedChars - separatorChars;
  if (remainingChars <= 0) {
    return usedChars;
  }

  const normalized = nextText.trim();
  if (normalized.length === 0) {
    return usedChars;
  }

  const capped = normalized.slice(0, remainingChars);
  parts.push(capped);
  return usedChars + separatorChars + capped.length;
}

async function loadTaskIndexRows(taskIds: string[]): Promise<TaskIndexRow[]> {
  if (taskIds.length === 0) {
    return [];
  }

  const result = await query<TaskIndexRow>(
    `SELECT t.id,
            t.workspace_id,
            t.environment_id,
            t.title,
            t.status,
            t.created_at,
            t.updated_at,
            t.trashed_at,
            t.folder_id,
            t.parent_task_id,
            t.workflow_parent_task_id,
            t.is_incognito,
            t.is_hidden,
            CASE
              WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
              WHEN ts.task_id IS NULL THEN 'standard'
              WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
              ELSE ts.mode
            END AS task_type
       FROM tasks t
       LEFT JOIN task_schedules ts ON ts.task_id = t.id
      WHERE t.id = ANY($1::uuid[])
        AND t.is_hidden = false`,
    [taskIds]
  );

  return result.rows;
}

async function loadTaskMessagesByTaskId(taskIds: string[]): Promise<Map<string, TaskMessageIndexRow[]>> {
  const messagesByTaskId = new Map<string, TaskMessageIndexRow[]>();
  if (taskIds.length === 0) {
    return messagesByTaskId;
  }

  const result = await query<TaskMessageIndexRow>(
    `WITH ranked_messages AS (
        SELECT task_id,
               role,
               content_json,
               created_at,
               id,
               ROW_NUMBER() OVER (
                 PARTITION BY task_id
                 ORDER BY created_at DESC, id DESC
               ) AS rn
          FROM task_messages
         WHERE task_id = ANY($1::uuid[])
           AND role <> 'tool'
      )
      SELECT task_id, role, content_json
        FROM ranked_messages
       WHERE rn <= $2
       ORDER BY task_id ASC, created_at ASC, id ASC`,
    [taskIds, MAX_INDEXED_MESSAGES_PER_TASK]
  );

  for (const row of result.rows) {
    const rows = messagesByTaskId.get(row.task_id) ?? [];
    rows.push(row);
    messagesByTaskId.set(row.task_id, rows);
  }

  return messagesByTaskId;
}

async function loadFoldersById(projectIds: string[]): Promise<Map<string, TaskFolderIndexRow>> {
  const foldersById = new Map<string, TaskFolderIndexRow>();
  if (projectIds.length === 0) {
    return foldersById;
  }

  const result = await query<TaskFolderIndexRow>(
    `SELECT id, environment_id, parent_folder_id
       FROM task_folders
      WHERE environment_id = ANY($1::uuid[])`,
    [projectIds]
  );

  for (const row of result.rows) {
    foldersById.set(row.id, row);
  }

  return foldersById;
}

export async function buildTaskSearchDocuments(taskIds: string[]): Promise<{
  documents: TaskSearchDocument[];
  deleteIds: string[];
}> {
  const taskRows = await loadTaskIndexRows(taskIds);
  const taskRowsById = new Map(taskRows.map((row) => [row.id, row]));
  const missingIds = taskIds.filter((taskId) => !taskRowsById.has(taskId));
  const indexableRows = taskRows.filter((row) => !row.parent_task_id && !row.workflow_parent_task_id && !row.is_incognito && !row.is_hidden);
  const nonIndexableIds = taskRows
    .filter((row) => row.parent_task_id || row.workflow_parent_task_id || row.is_incognito || row.is_hidden)
    .map((row) => row.id);
  const [messagesByTaskId, foldersById] = await Promise.all([
    loadTaskMessagesByTaskId(indexableRows.map((row) => row.id)),
    loadFoldersById([...new Set(indexableRows.map((row) => row.environment_id))])
  ]);

  const documents = indexableRows.map<TaskSearchDocument>((row) => {
    const messages = messagesByTaskId.get(row.id) ?? [];
    const contentParts: string[] = [];
    let contentCharCount = 0;
    for (const message of messages) {
      contentCharCount = appendCappedText(
        contentParts,
        contentCharCount,
        extractTaskSearchableText(message.content_json),
        MAX_INDEXED_CONTENT_CHARS
      );
      if (contentCharCount >= MAX_INDEXED_CONTENT_CHARS) {
        break;
      }
    }
    const contentText = contentParts.join("\n\n");
    const title = row.title?.trim() || "Untitled Task";

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.environment_id,
      title,
      titleSort: title.toLocaleLowerCase(),
      contentText,
      status: row.status,
      scope: row.trashed_at ? "trashed" : "active",
      taskType: row.task_type,
      folderId: row.folder_id,
      folderPathIds: buildFolderPathIds(row.folder_id, foldersById),
      isUnfiled: row.folder_id === null,
      createdAtMs: toTimestampMs(row.created_at),
      updatedAtMs: toTimestampMs(row.updated_at)
    };
  });

  return {
    documents,
    deleteIds: [...missingIds, ...nonIndexableIds]
  };
}

export async function syncTaskSearchDocuments(taskIds: string[]): Promise<void> {
  const uniqueTaskIds = [...new Set(taskIds)];
  if (uniqueTaskIds.length === 0) {
    return;
  }

  const client = createMeilisearchClient();
  if (!client) {
    return;
  }

  const index = client.index<TaskSearchDocument>(getTaskSearchIndexUid());
  for (let start = 0; start < uniqueTaskIds.length; start += MAX_INDEXING_TASKS_PER_CHUNK) {
    const taskIdChunk = uniqueTaskIds.slice(start, start + MAX_INDEXING_TASKS_PER_CHUNK);
    const { documents, deleteIds } = await buildTaskSearchDocuments(taskIdChunk);
    const tasks = [];

    if (documents.length > 0) {
      tasks.push(index.addDocuments(documents, { primaryKey: "id" }));
    }
    if (deleteIds.length > 0) {
      tasks.push(index.deleteDocuments(deleteIds));
    }

    for (const task of tasks) {
      await client.tasks.waitForTask(await task);
    }
  }
}

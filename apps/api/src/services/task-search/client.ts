import { Meilisearch } from "meilisearch";
import { config } from "../../lib/config.js";
import { TASK_SEARCH_INDEX_UID } from "./types.js";

export function isTaskSearchEnabled(): boolean {
  return Boolean(config.search?.meilisearch.host);
}

export function getTaskSearchIndexUid(): string {
  return config.search?.meilisearch.indexUid ?? TASK_SEARCH_INDEX_UID;
}

export function getTaskSearchSyncBatchSize(): number {
  return config.search?.meilisearch.syncBatchSize ?? 100;
}

export function getTaskSearchSyncIntervalMs(): number {
  return config.search?.meilisearch.syncIntervalMs ?? 1000;
}

export function createMeilisearchClient(): Meilisearch | null {
  const meilisearch = config.search?.meilisearch;
  if (!meilisearch?.host) {
    return null;
  }

  return new Meilisearch({
    host: meilisearch.host,
    apiKey: meilisearch.apiKey
  });
}

export async function ensureTaskSearchIndex(): Promise<void> {
  const client = createMeilisearchClient();
  if (!client) {
    return;
  }

  const indexUid = getTaskSearchIndexUid();
  try {
    await client.getIndex(indexUid);
  } catch {
    const task = await client.createIndex(indexUid, { primaryKey: "id" });
    await client.tasks.waitForTask(task);
  }

  const index = client.index(indexUid);
  const task = await index.updateSettings({
    searchableAttributes: ["title", "contentText"],
    displayedAttributes: ["id", "title", "contentText"],
    filterableAttributes: [
      "id",
      "workspaceId",
      "projectId",
      "status",
      "scope",
      "taskType",
      "folderId",
      "folderPathIds",
      "isUnfiled"
    ],
    sortableAttributes: ["updatedAtMs", "createdAtMs", "titleSort", "status"]
  });
  await client.tasks.waitForTask(task);
}

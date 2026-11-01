import type { ContextWindowRef, HistorySearchInput, HistorySearchResult } from "@meowbert/run-executor/agent/ports/run-control";
import { resolveMemoryEmbeddingConfig } from "../memory/embedding-config.js";
import { readScore, runHybridQuery } from "../memory/hybrid-query.js";
import { applyEmbeddingTemplate, embedTexts } from "../memory/indexing.js";
import { MEMORY_SEARCH_TEXT_COLUMN } from "../memory/shared.js";
import { listContextHistoryWindows } from "../context-management-v2/tools.js";
import { readEmbeddingFeatures } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { indexTaskHistory } from "./indexing.js";
import { escapeSqlString, openHistoryConnection, openHistoryTable } from "./storage.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const RESULT_COLUMNS = ["item_id", "window_id", "call_number", "role", "tool", MEMORY_SEARCH_TEXT_COLUMN];

function inList(column: string, values: string[]): string {
  return `${column} IN (${values.map((value) => `'${escapeSqlString(value)}'`).join(", ")})`;
}

// Searches the windows on this window's lineage, the same ones its history files show.
export async function searchTaskHistory(state: ContextWindowRef, input: HistorySearchInput): Promise<HistorySearchResult> {
  if (!(await readEmbeddingFeatures(query)).historySearchEnabled) return { error: "Session history search is switched off.", items: [] };
  await indexTaskHistory(state.taskId);
  const windowIds = (await listContextHistoryWindows(state))
    .map((window) => window.windowId)
    .filter((windowId) => !input.window_id || windowId === input.window_id);
  if (windowIds.length === 0) return { items: [] };

  const connection = await openHistoryConnection();
  try {
    const table = await openHistoryTable(connection);
    if (!table) return { items: [] };
    const config = await resolveMemoryEmbeddingConfig();
    const [queryVector] = await embedTexts([applyEmbeddingTemplate(config.queryPromptTemplate, input.query)], config);
    const predicate = [
      `task_id = '${escapeSqlString(state.taskId)}'`,
      inList("window_id", windowIds),
      input.role ? `role = '${escapeSqlString(input.role)}'` : null,
      input.tool ? `tool = '${escapeSqlString(input.tool)}'` : null
    ].filter(Boolean).join(" AND ");
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)));
    const rows = await runHybridQuery({ table, queryVector, queryText: input.query, predicate, limit: limit * 3, columns: RESULT_COLUMNS });
    // The best chunk of each item, so one long output does not fill every result.
    const seen = new Set<string>();
    const items = rows.flatMap((row) => {
      const itemId = String(row.item_id);
      if (seen.has(itemId)) return [];
      seen.add(itemId);
      return [{
        item_id: itemId,
        window_id: String(row.window_id),
        call_number: typeof row.call_number === "number" && row.call_number > 0 ? row.call_number : null,
        role: String(row.role),
        tool: typeof row.tool === "string" && row.tool ? row.tool : null,
        score: readScore(row),
        excerpt: String(row[MEMORY_SEARCH_TEXT_COLUMN] ?? "")
      }];
    }).slice(0, limit);
    return { items };
  } finally {
    connection.close();
  }
}

import { MatchQuery, rerankers, type Table } from "@lancedb/lancedb";
import { MEMORY_SEARCH_TEXT_COLUMN } from "./shared.js";

let rrfReranker: Promise<rerankers.RRFReranker> | null = null;

// Higher is always better: RRF relevance for hybrid results, cosine similarity for vector-only.
export function readScore(row: Record<string, unknown>): number {
  if (typeof row._relevance_score === "number") {
    return row._relevance_score;
  }
  return typeof row._distance === "number" ? 1 - row._distance : 0;
}

// Hybrid search: keyword (BM25) and vector results merged with Reciprocal Rank Fusion, so exact
// names and commands match even when embeddings miss them. Falls back to vector-only when the
// keyword index is unavailable. The table's keyword column is MEMORY_SEARCH_TEXT_COLUMN.
export async function runHybridQuery(input: {
  table: Table;
  queryVector: number[];
  queryText: string;
  predicate: string | null;
  limit: number;
  columns: string[];
}): Promise<Array<Record<string, unknown>>> {
  const vectorQuery = () => {
    const query = input.table.vectorSearch(input.queryVector).distanceType("cosine").limit(input.limit);
    return input.predicate ? query.where(input.predicate) : query;
  };

  try {
    rrfReranker ??= rerankers.RRFReranker.create();
    return await vectorQuery()
      .fullTextSearch(new MatchQuery(input.queryText, MEMORY_SEARCH_TEXT_COLUMN))
      .rerank(await rrfReranker)
      .select(input.columns)
      .toArray();
  } catch (error) {
    console.warn(`[memory] Hybrid search unavailable, using vector search: ${error instanceof Error ? error.message : String(error)}`);
    return vectorQuery().select(input.columns).toArray();
  }
}

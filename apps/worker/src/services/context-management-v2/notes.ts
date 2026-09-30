import { withTransaction } from "../../lib/db.js";
import { accessibleNodesCte } from "./lineage.js";
import type { ContextManagementV2State } from "./types.js";

const MAX_NOTE_BYTES = 1_000_000;

function validatePath(path: string): string {
  const normalized = path.trim().replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Note path must be a non-empty virtual path without '.', '..', or empty components.");
  }
  return normalized;
}

export async function writeContextNote(input: { state: ContextManagementV2State; path: string; text: string; append: boolean }): Promise<{ path: string; bytes: number }> {
  const path = validatePath(input.path);
  return withTransaction(async (client) => {
    await client.query("SELECT id FROM task_context_nodes WHERE id = $1 FOR UPDATE", [input.state.contextNodeId]);
    const existing = await client.query<{ content: string }>(
      `${accessibleNodesCte(3)}
       SELECT note.content
         FROM task_context_notes note
         JOIN context_lineage ON context_lineage.id = note.context_node_id
        WHERE note.task_id = $1 AND note.path = $2
        ORDER BY context_lineage.depth ASC, note.revision DESC
        LIMIT 1`,
      [input.state.taskId, path, input.state.contextNodeId]
    );
    const content = input.append ? `${existing.rows[0]?.content ?? ""}${input.text}` : input.text;
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_NOTE_BYTES) throw new Error("Note files may not exceed 1,000,000 UTF-8 bytes.");
    const revision = await client.query<{ revision: number }>(
      "SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM task_context_notes WHERE task_id = $1 AND context_node_id = $2 AND path = $3",
      [input.state.taskId, input.state.contextNodeId, path]
    );
    await client.query(
      `INSERT INTO task_context_notes (task_id, context_node_id, path, revision, content)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.state.taskId, input.state.contextNodeId, path, revision.rows[0]?.revision ?? 1, content]
    );
    await client.query(
      `DELETE FROM task_context_notes WHERE task_id = $1 AND context_node_id = $2 AND path = $3 AND revision < $4`,
      [input.state.taskId, input.state.contextNodeId, path, revision.rows[0]?.revision ?? 1]
    );
    return { path, bytes };
  });
}


import type { CanvasComment } from "@meowbert/shared";
import type { CanvasElementSelection } from "@meowbert/shared/canvas-frame";
import { query } from "../../lib/db.js";

export interface CanvasCommentScope {
  canvasId?: string;
  taskId?: string;
  relativePath: string;
}

const COLUMNS = `id, relative_path AS "relativePath", element, body, resolved, created_at AS "createdAt"`;
const SCOPE = "canvas_id IS NOT DISTINCT FROM $1::uuid AND task_id IS NOT DISTINCT FROM $2::uuid AND relative_path = $3";

function scopeValues(scope: CanvasCommentScope) {
  return [scope.canvasId ?? null, scope.taskId ?? null, scope.relativePath];
}

export async function listCanvasComments(scope: CanvasCommentScope): Promise<CanvasComment[]> {
  const result = await query<CanvasComment>(`SELECT ${COLUMNS} FROM canvas_comments WHERE ${SCOPE} ORDER BY created_at, id`, scopeValues(scope));
  return result.rows;
}

export async function addCanvasComment(scope: CanvasCommentScope, userId: string, element: CanvasElementSelection, body: string): Promise<CanvasComment> {
  const result = await query<CanvasComment>(
    `INSERT INTO canvas_comments(canvas_id, task_id, relative_path, created_by, element, body)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING ${COLUMNS}`,
    [...scopeValues(scope), userId, JSON.stringify(element), body]
  );
  return result.rows[0];
}

export async function resolveCanvasComment(scope: CanvasCommentScope, id: string, resolved: boolean): Promise<CanvasComment | null> {
  const result = await query<CanvasComment>(
    `UPDATE canvas_comments SET resolved = $5 WHERE ${SCOPE} AND id = $4 RETURNING ${COLUMNS}`,
    [...scopeValues(scope), id, resolved]
  );
  return result.rows[0] ?? null;
}

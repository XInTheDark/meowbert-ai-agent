import type { ProjectMapDb } from "@meowbert/shared";

// Short descriptions of map items for the change notes the Master reads, with IDs it can act on.

export async function describeFolder(db: ProjectMapDb, folderId: string | null): Promise<string> {
  if (!folderId) return "the top level";
  const result = await db.query<{ name: string }>("SELECT name FROM task_folders WHERE id = $1", [folderId]);
  return `folder "${result.rows[0]?.name ?? "unknown"}" [${folderId}]`;
}

export async function describeCard(db: ProjectMapDb, cardId: string): Promise<string> {
  const result = await db.query<{ title: string }>("SELECT title FROM project_map_cards WHERE id = $1", [cardId]);
  return `card "${result.rows[0]?.title ?? "unknown"}" [${cardId}]`;
}

const MAX_DESCRIBED_ITEMS = 10;

export async function describeMapItems(db: ProjectMapDb, ids: string[]): Promise<string> {
  const shown = ids.slice(0, MAX_DESCRIBED_ITEMS);
  const result = await db.query<{ id: string; kind: string; label: string | null }>(
    `SELECT id, 'folder' AS kind, name AS label FROM task_folders WHERE id = ANY($1::uuid[])
     UNION ALL SELECT id, 'card', title FROM project_map_cards WHERE id = ANY($1::uuid[])
     UNION ALL SELECT id, 'task', title FROM tasks WHERE id = ANY($1::uuid[])`,
    [shown]
  );
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  const parts = shown.map((id) => {
    const row = byId.get(id);
    return row ? `${row.kind} "${row.label ?? "Untitled task"}" [${id}]` : `[${id}]`;
  });
  const more = ids.length - shown.length;
  return more > 0 ? `${parts.join(", ")} and ${more} more` : parts.join(", ");
}

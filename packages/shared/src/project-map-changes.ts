import type { ProjectMapDb } from "./project-map-db.js";

const MAX_CHANGES_PER_DELIVERY = 30;

export interface ProjectMapChange {
  actorName: string | null;
  summary: string;
}

// Queues a member's map edit for the project's Master. Projects without a Master keep no queue.
export async function recordProjectMapChange(
  db: ProjectMapDb,
  input: { environmentId: string; actorUserId: string; summary: string }
): Promise<void> {
  await db.query(
    `INSERT INTO project_map_changes (environment_id, actor_user_id, summary)
     SELECT $1, $2, $3
      WHERE EXISTS (SELECT 1 FROM project_masters WHERE environment_id = $1)`,
    [input.environmentId, input.actorUserId, input.summary]
  );
}

// Takes the oldest queued edits off the queue, so each is delivered once.
export async function claimProjectMapChanges(db: ProjectMapDb, environmentId: string): Promise<ProjectMapChange[]> {
  const result = await db.query<{ actor_name: string | null; summary: string }>(
    `WITH claimed AS (
       DELETE FROM project_map_changes
        WHERE id IN (
          SELECT id FROM project_map_changes WHERE environment_id = $1
           ORDER BY created_at, id LIMIT $2 FOR UPDATE SKIP LOCKED
        )
       RETURNING actor_user_id, summary, created_at, id
     )
     SELECT NULLIF(btrim(u.display_name), '') AS actor_name, c.summary
       FROM claimed c
       LEFT JOIN users u ON u.id = c.actor_user_id
      ORDER BY c.created_at, c.id`,
    [environmentId, MAX_CHANGES_PER_DELIVERY]
  );
  return result.rows.map((row) => ({ actorName: row.actor_name, summary: row.summary }));
}

export function formatProjectMapChanges(changes: ProjectMapChange[]): string {
  const lines = changes.map((change) => `- ${change.actorName ?? "A member"} ${change.summary}`);
  return ["[Map update] The project map was changed outside this conversation:", ...lines].join("\n");
}

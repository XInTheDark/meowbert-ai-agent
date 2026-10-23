import type { PoolClient } from "pg";
import { withTransaction } from "../../lib/db.js";
import type { SwarmLaneRow } from "./lane-store.js";
import { lockSwarmInTx } from "./scheduler.js";

export type SwarmNoteKind = "shared" | "auto";

export interface SwarmNote {
  seq: string;
  kind: SwarmNoteKind;
  content: string;
  author_title: string;
}

const MAX_NOTES_PER_DELIVERY = 50;

// Notes are inserted under the swarm lock, so sequence numbers commit in order and a reader that
// has seen a note has seen every earlier one: the per-lane cursor never skips a note.
export async function insertSwarmNote(note: {
  swarmTaskId: string;
  authorTaskId: string;
  scopeParentTaskId: string;
  kind: SwarmNoteKind;
  content: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    await lockSwarmInTx(client, note.swarmTaskId);
    await client.query(
      `INSERT INTO task_swarm_notes (swarm_task_id, author_task_id, scope_parent_task_id, kind, content)
       VALUES ($1, $2, $3, $4, $5)`,
      [note.swarmTaskId, note.authorTaskId, note.scopeParentTaskId, note.kind, note.content]
    );
  });
}

// A lane reads notes from its siblings (same parent) and from its ancestor lanes, never its own and
// never from other branches; information between branches flows through merges.
export async function claimLaneNotesInTx(
  client: PoolClient,
  lane: Pick<SwarmLaneRow, "task_id" | "swarm_task_id" | "parent_task_id">,
  ancestorLaneIds: string[]
): Promise<SwarmNote[]> {
  const cursor = await client.query<{ note_cursor: string }>(
    "SELECT note_cursor FROM task_swarm_lanes WHERE task_id = $1 FOR UPDATE",
    [lane.task_id]
  );
  const notes = await client.query<SwarmNote>(
    `SELECT note.seq::text AS seq, note.kind, note.content, COALESCE(author.title, 'Leader') AS author_title
       FROM task_swarm_notes note
       LEFT JOIN task_swarm_lanes author ON author.task_id = note.author_task_id
      WHERE note.swarm_task_id = $1
        AND note.seq > $2::bigint
        AND note.author_task_id <> $3
        AND (note.scope_parent_task_id = $4 OR note.author_task_id = ANY($5::uuid[]))
      ORDER BY note.seq
      LIMIT $6`,
    [lane.swarm_task_id, cursor.rows[0]?.note_cursor ?? "0", lane.task_id, lane.parent_task_id, ancestorLaneIds, MAX_NOTES_PER_DELIVERY]
  );
  if (notes.rows.length > 0) {
    await client.query("UPDATE task_swarm_lanes SET note_cursor = $2::bigint, updated_at = now() WHERE task_id = $1", [
      lane.task_id,
      notes.rows[notes.rows.length - 1].seq
    ]);
  }
  return notes.rows;
}

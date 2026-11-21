import type { PoolClient } from "pg";
import { withTransaction } from "../../lib/db.js";
import type { SwarmLaneRow } from "./lane-store.js";
import { wakeParentIfBarrierMetInTx } from "./barrier.js";
import { emitSwarmEvent } from "./events.js";
import { lockSwarmInTx } from "./scheduler.js";
import type { ParentShareNote, ShareNotifyMode, SwarmNote, SwarmNoteKind } from "@meowbert/run-executor/agent-swarm/lane-types";

export type { ParentShareNote, ShareNotifyMode, SwarmNote, SwarmNoteKind } from "@meowbert/run-executor/agent-swarm/lane-types";

const MAX_NOTES_PER_DELIVERY = 50;

// Notes are inserted under the swarm lock, so sequence numbers commit in order and a reader that
// has seen a note has seen every earlier one: the per-lane cursor never skips a note.
export async function insertSwarmNote(note: {
  swarmTaskId: string;
  authorTaskId: string;
  scopeParentTaskId: string;
  kind: SwarmNoteKind;
  content: string;
  notifySiblings?: boolean;
  notifyParent?: ShareNotifyMode;
}): Promise<{ parentWoken: boolean }> {
  const notifySiblings = note.notifySiblings ?? true;
  const notifyParent: ShareNotifyMode = note.notifyParent ?? "none";
  const parentWoken = await withTransaction(async (client) => {
    await lockSwarmInTx(client, note.swarmTaskId);
    await client.query(
      `INSERT INTO task_swarm_notes (swarm_task_id, author_task_id, scope_parent_task_id, kind, content, notify_siblings, notify_parent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [note.swarmTaskId, note.authorTaskId, note.scopeParentTaskId, note.kind, note.content, notifySiblings, notifyParent]
    );
    return notifyParent === "wake" ? wakeParentIfBarrierMetInTx(client, note.scopeParentTaskId) : false;
  });
  await emitSwarmEvent(note.swarmTaskId, note.content, {
    laneId: note.authorTaskId,
    noteKind: note.kind,
    ...(!notifySiblings ? { notifySiblings: false } : {}),
    ...(notifyParent !== "none" ? { notifyParent } : {})
  });
  return { parentWoken };
}

interface ScopedNote extends SwarmNote {
  author_task_id: string;
}

// Diverge answers are independent only while they cannot see each other, so a diverge lane gets no
// sibling notes until every sibling has finished.
async function hasActiveSiblingInTx(client: PoolClient, lane: Pick<SwarmLaneRow, "task_id" | "parent_task_id">): Promise<boolean> {
  const result = await client.query(
    "SELECT 1 FROM task_swarm_lanes WHERE parent_task_id = $1 AND task_id <> $2 AND status IN ('queued', 'running', 'waiting') LIMIT 1",
    [lane.parent_task_id, lane.task_id]
  );
  return (result.rowCount ?? 0) > 0;
}

// While a lane is blind to its siblings, delivery stops before the first sibling note, so that note
// and everything after it arrive once the lane may see them. Ancestors of a running lane are parked
// and write no notes, so nothing an ancestor shares waits behind it in practice.
export function takeUntilBlockedNote<T extends { author_task_id: string }>(notes: T[], ancestorLaneIds: string[]): T[] {
  const blockedAt = notes.findIndex((note) => !ancestorLaneIds.includes(note.author_task_id));
  return blockedAt === -1 ? notes : notes.slice(0, blockedAt);
}

// A lane reads notes from its siblings (same parent) and from its ancestor lanes, never its own and
// never from other branches; information between branches flows through merges.
export async function claimLaneNotesInTx(
  client: PoolClient,
  lane: Pick<SwarmLaneRow, "task_id" | "swarm_task_id" | "parent_task_id" | "kind">,
  ancestorLaneIds: string[]
): Promise<SwarmNote[]> {
  const cursor = await client.query<{ note_cursor: string }>(
    "SELECT note_cursor FROM task_swarm_lanes WHERE task_id = $1 FOR UPDATE",
    [lane.task_id]
  );
  const candidates = await client.query<ScopedNote>(
    `SELECT note.seq::text AS seq, note.kind, note.content, note.author_task_id, COALESCE(author.title, 'Leader') AS author_title
       FROM task_swarm_notes note
       LEFT JOIN task_swarm_lanes author ON author.task_id = note.author_task_id
      WHERE note.swarm_task_id = $1
        AND note.seq > $2::bigint
        AND note.author_task_id <> $3
        AND note.notify_siblings = true
        AND (note.scope_parent_task_id = $4 OR note.author_task_id = ANY($5::uuid[]))
      ORDER BY note.seq
      LIMIT $6`,
    [lane.swarm_task_id, cursor.rows[0]?.note_cursor ?? "0", lane.task_id, lane.parent_task_id, ancestorLaneIds, MAX_NOTES_PER_DELIVERY]
  );
  const blind = lane.kind === "diverge" && await hasActiveSiblingInTx(client, lane);
  const notes = blind ? takeUntilBlockedNote(candidates.rows, ancestorLaneIds) : candidates.rows;
  if (notes.length > 0) {
    await client.query("UPDATE task_swarm_lanes SET note_cursor = $2::bigint, updated_at = now() WHERE task_id = $1", [
      lane.task_id,
      notes[notes.length - 1].seq
    ]);
  }
  return notes.map(({ author_task_id: _author, ...note }) => note);
}

// Explicit share notes addressed to this parent's inbox (notify = 'inbox' or 'wake'), claimed once
// in sequence order inside the parent's inbox transaction.
export async function claimParentShareNotesInTx(
  client: PoolClient,
  parentTaskId: string
): Promise<ParentShareNote[]> {
  const pending = await client.query<ParentShareNote>(
    `SELECT note.seq::text AS seq, note.author_task_id, COALESCE(author.title, 'Lane') AS author_title,
            note.content, note.notify_parent
       FROM task_swarm_notes note
       LEFT JOIN task_swarm_lanes author ON author.task_id = note.author_task_id
      WHERE note.scope_parent_task_id = $1
        AND note.notify_parent <> 'none'
        AND note.parent_delivered_at IS NULL
      ORDER BY note.seq
      LIMIT $2
      FOR UPDATE OF note`,
    [parentTaskId, MAX_NOTES_PER_DELIVERY]
  );
  if (pending.rows.length === 0) return [];
  await client.query(
    "UPDATE task_swarm_notes SET parent_delivered_at = now() WHERE seq = ANY($1::bigint[])",
    [pending.rows.map((row) => row.seq)]
  );
  return pending.rows;
}

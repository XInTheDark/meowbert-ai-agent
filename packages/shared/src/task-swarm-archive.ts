import { z } from "zod";
import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";

// Agent Swarm payloads kept with the task that owns them: a swarm root keeps its fork seeds (the
// largest payloads) and notes, a lane keeps its submitted result. Rows, IDs and lane state stay in
// place; only the payloads move to the archive.
export const taskSwarmArchiveSchema = z.object({
  fork_seeds: z.array(z.object({
    id: z.string().uuid(),
    envelope_json: z.unknown(),
    tools_json: z.unknown(),
    items_json: z.unknown()
  })),
  notes: z.array(z.object({ seq: z.string(), content: z.string() })),
  lane_results: z.array(z.object({ task_id: z.string().uuid(), result_json: z.unknown() }))
});
export type TaskSwarmArchive = z.infer<typeof taskSwarmArchiveSchema>;

export async function loadTaskSwarmArchive(client: TaskHistoryArchiveQueryable, taskId: string): Promise<TaskSwarmArchive> {
  const [seeds, notes, lanes] = await Promise.all([
    client.query<TaskSwarmArchive["fork_seeds"][number]>(
      "SELECT id, envelope_json, tools_json, items_json FROM task_swarm_fork_seeds WHERE swarm_task_id = $1", [taskId]),
    client.query<TaskSwarmArchive["notes"][number]>(
      "SELECT seq::text AS seq, content FROM task_swarm_notes WHERE swarm_task_id = $1", [taskId]),
    client.query<TaskSwarmArchive["lane_results"][number]>(
      "SELECT task_id, result_json FROM task_swarm_lanes WHERE task_id = $1 AND result_json IS NOT NULL", [taskId])
  ]);
  return { fork_seeds: seeds.rows, notes: notes.rows, lane_results: lanes.rows };
}

export async function stubTaskSwarmArchive(client: TaskHistoryArchiveQueryable, taskId: string): Promise<void> {
  await client.query(
    `UPDATE task_swarm_fork_seeds SET envelope_json = '{}'::jsonb, tools_json = '{}'::jsonb, items_json = '[]'::jsonb
      WHERE swarm_task_id = $1`,
    [taskId]
  );
  await client.query("UPDATE task_swarm_notes SET content = '' WHERE swarm_task_id = $1", [taskId]);
  await client.query("UPDATE task_swarm_lanes SET result_json = '{}'::jsonb WHERE task_id = $1 AND result_json IS NOT NULL", [taskId]);
}

export async function restoreTaskSwarmArchive(client: TaskHistoryArchiveQueryable, archive?: TaskSwarmArchive): Promise<void> {
  if (!archive) return;
  for (const seed of archive.fork_seeds) await client.query(
    "UPDATE task_swarm_fork_seeds SET envelope_json = $2::jsonb, tools_json = $3::jsonb, items_json = $4::jsonb WHERE id = $1",
    [seed.id, JSON.stringify(seed.envelope_json), JSON.stringify(seed.tools_json), JSON.stringify(seed.items_json)]);
  for (const note of archive.notes) await client.query(
    "UPDATE task_swarm_notes SET content = $2 WHERE seq = $1::bigint", [note.seq, note.content]);
  for (const lane of archive.lane_results) await client.query(
    "UPDATE task_swarm_lanes SET result_json = $2::jsonb WHERE task_id = $1", [lane.task_id, JSON.stringify(lane.result_json)]);
}

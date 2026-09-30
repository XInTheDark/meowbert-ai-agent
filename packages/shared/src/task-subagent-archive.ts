import { z } from "zod";
import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";

export const taskSubagentArchiveSchema = z.object({
  sessions: z.array(z.object({ task_id: z.string().uuid(), runtime_json: z.record(z.string(), z.unknown()) })),
  mail: z.array(z.object({ id: z.string().uuid(), body: z.string() })),
  waits: z.array(z.object({ task_id: z.string().uuid(), resume_job_json: z.record(z.string(), z.unknown()) }))
});
export type TaskSubagentArchive = z.infer<typeof taskSubagentArchiveSchema>;

export async function loadTaskSubagentArchive(client: TaskHistoryArchiveQueryable, taskId: string): Promise<TaskSubagentArchive> {
  const [sessions, mail, waits] = await Promise.all([
    client.query<TaskSubagentArchive["sessions"][number]>(
      "SELECT task_id, runtime_json FROM task_subagent_sessions WHERE task_id = $1", [taskId]),
    client.query<TaskSubagentArchive["mail"][number]>(
      "SELECT id, body FROM task_subagent_mail WHERE recipient_task_id = $1", [taskId]),
    client.query<TaskSubagentArchive["waits"][number]>(
      "SELECT task_id, resume_job_json FROM task_subagent_waits WHERE task_id = $1", [taskId])
  ]);
  return { sessions: sessions.rows, mail: mail.rows, waits: waits.rows };
}

export async function stubTaskSubagentArchive(client: TaskHistoryArchiveQueryable, taskId: string): Promise<void> {
  // Preserve identities, routing, and acknowledgement state; archive only payloads.
  await client.query("UPDATE task_subagent_sessions SET runtime_json = '{}'::jsonb WHERE task_id = $1", [taskId]);
  await client.query("UPDATE task_subagent_mail SET body = '' WHERE recipient_task_id = $1", [taskId]);
  await client.query("UPDATE task_subagent_waits SET resume_job_json = '{}'::jsonb WHERE task_id = $1", [taskId]);
}

export async function restoreTaskSubagentArchive(client: TaskHistoryArchiveQueryable, archive?: TaskSubagentArchive): Promise<void> {
  if (!archive) return;
  for (const session of archive.sessions) await client.query(
    "UPDATE task_subagent_sessions SET runtime_json = $2::jsonb WHERE task_id = $1", [session.task_id, JSON.stringify(session.runtime_json)]);
  for (const message of archive.mail) await client.query(
    "UPDATE task_subagent_mail SET body = $2 WHERE id = $1", [message.id, message.body]);
  for (const wait of archive.waits) await client.query(
    "UPDATE task_subagent_waits SET resume_job_json = $2::jsonb WHERE task_id = $1", [wait.task_id, JSON.stringify(wait.resume_job_json)]);
}

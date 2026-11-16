import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn() }));
import { claimQueuedUserMessages } from "./claim.js";

const databaseUrl = process.env.TEST_SCHEDULE_SEND_DATABASE_URL;
describe.skipIf(!databaseUrl)("scheduled message claims in PostgreSQL", () => {
  const client = new Client({ connectionString: databaseUrl });
  const schema = `scheduled_send_${randomUUID().replaceAll("-", "")}`;
  const taskId = randomUUID();
  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query("CREATE TABLE tasks(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY)");
    for (const name of ["153_task_queued_messages.sql", "165_scheduled_messages.sql"]) {
      await client.query(await readFile(new URL(`../../../../../db/migrations/${name}`, import.meta.url), "utf8"));
    }
    await client.query("INSERT INTO tasks(id) VALUES ($1)", [taskId]);
  });
  beforeEach(async () => { await client.query("DELETE FROM task_queued_messages"); });
  afterAll(async () => { await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); });

  it("delivers immediate and due messages while leaving future sends queued", async () => {
    await client.query(`INSERT INTO task_queued_messages(task_id, content_json, send_at) VALUES
      ($1, '{"text":"immediate"}', NULL), ($1, '{"text":"due"}', now() - interval '1 minute'),
      ($1, '{"text":"future"}', now() + interval '1 hour')`, [taskId]);
    const messages = await claimQueuedUserMessages(client as unknown as PoolClient, taskId);
    expect(messages.map((message) => message.content.text).sort()).toEqual(["due", "immediate"]);
    const remaining = await client.query("SELECT content_json FROM task_queued_messages");
    expect(remaining.rows.map((row) => row.content_json.text)).toEqual(["future"]);
  });

  it("claims only due scheduled messages when waking an idle task", async () => {
    await client.query(`INSERT INTO task_queued_messages(task_id, content_json, send_at) VALUES
      ($1, '{"text":"immediate"}', NULL), ($1, '{"text":"due"}', now() - interval '1 minute')`, [taskId]);
    expect((await claimQueuedUserMessages(client as unknown as PoolClient, taskId, true)).map((message) => message.content.text)).toEqual(["due"]);
    expect((await client.query("SELECT content_json FROM task_queued_messages")).rows[0].content_json.text).toBe("immediate");
    expect(await claimQueuedUserMessages(client as unknown as PoolClient, taskId, true)).toEqual([]);
  });
});

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: null as Client | null }));
vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: async (callback: (client: Client) => Promise<unknown>) => {
    const client = state.client!;
    await client.query("BEGIN");
    try { const result = await callback(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  }
}));
vi.mock("../../lib/config.js", () => ({ config: {} }));
vi.mock("../billing/subscriptions.js", () => ({ currentUtcMonthBounds: vi.fn() }));

import { deleteUser } from "./admin-users.js";

const databaseUrl = process.env.TEST_CONTEXT_DATABASE_URL;

describe.skipIf(!databaseUrl)("user deletion foreign key integration", () => {
  let schema: string;

  beforeEach(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    state.client = client;
    schema = `audit_user_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id text PRIMARY KEY);
      CREATE TABLE devices (id text PRIMARY KEY, user_id text REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE tasks (id text PRIMARY KEY, initiator_user_id text REFERENCES users(id));
      CREATE TABLE environments (id text PRIMARY KEY, created_by text REFERENCES users(id));
      CREATE TABLE task_message_revisions (id text PRIMARY KEY, edited_by_user_id text REFERENCES users(id));
      CREATE TABLE audit_logs (id text PRIMARY KEY, actor_user_id text REFERENCES users(id));
      CREATE TABLE task_run_dispatches (id text PRIMARY KEY, priority_actor_user_id text REFERENCES users(id));
      CREATE TABLE project_canvases (id text PRIMARY KEY, created_by text REFERENCES users(id));
      CREATE TABLE workspace_device_relinks (
        workspace_id text PRIMARY KEY, old_device_id text NOT NULL REFERENCES devices(id), new_device_id text NOT NULL REFERENCES devices(id)
      );
      INSERT INTO users VALUES ('removed'), ('retained');
      INSERT INTO devices VALUES ('old', 'removed'), ('new', 'removed'), ('other', 'retained');
      INSERT INTO tasks VALUES ('task', 'removed');
      INSERT INTO environments VALUES ('project', 'removed');
      INSERT INTO task_message_revisions VALUES ('revision', 'removed');
      INSERT INTO audit_logs VALUES ('audit', 'removed');
      INSERT INTO task_run_dispatches VALUES ('dispatch', 'removed');
      INSERT INTO project_canvases VALUES ('canvas', 'removed'), ('other-canvas', 'retained');
      INSERT INTO workspace_device_relinks VALUES ('old-device-link', 'old', 'other'), ('new-device-link', 'other', 'new');
    `);
  });

  afterEach(async () => {
    if (!state.client) return;
    await state.client.query(`DROP SCHEMA ${schema} CASCADE`);
    await state.client.end();
    state.client = null;
  });

  it("deletes a user with dispatch, canvas, and both relink references while retaining shared history", async () => {
    await deleteUser("removed");
    const client = state.client!;
    expect((await client.query("SELECT id FROM users")).rows).toEqual([{ id: "retained" }]);
    expect((await client.query("SELECT * FROM project_canvases ORDER BY id")).rows).toEqual([
      { id: "canvas", created_by: null }, { id: "other-canvas", created_by: "retained" }
    ]);
    expect((await client.query("SELECT * FROM task_run_dispatches")).rows).toEqual([{ id: "dispatch", priority_actor_user_id: null }]);
    expect((await client.query("SELECT id FROM devices")).rows).toEqual([{ id: "other" }]);
    expect((await client.query("SELECT * FROM workspace_device_relinks")).rowCount).toBe(0);
    expect((await client.query("SELECT * FROM tasks")).rows).toEqual([{ id: "task", initiator_user_id: null }]);
  });

  it("keeps the existing missing-user error", async () => {
    await expect(deleteUser("missing")).rejects.toThrow("User not found");
    expect((await state.client!.query("SELECT id FROM users")).rowCount).toBe(2);
  });
});

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildProjectMapRollups,
  claimProjectMapChanges,
  deleteProjectFolder,
  loadProjectMap,
  moveProjectMapItems,
  recordProjectMapChange,
  type ProjectMapDb
} from "@meowbert/shared";
import type { ProjectMapOperation } from "@meowbert/run-executor/agent-tools/project-map";
import { applyProjectMapOperations } from "./map-operations.js";

function op(fields: Partial<ProjectMapOperation> & Pick<ProjectMapOperation, "op">): ProjectMapOperation {
  return { ref: null, id: null, parent_id: null, ids: null, name: null, text: null, state: null, ...fields };
}

// Supply a disposable PostgreSQL database; each run uses and removes its own schema.
const databaseUrl = process.env.TEST_PROJECT_MASTER_DATABASE_URL;
describe.skipIf(!databaseUrl)("Project map in PostgreSQL", () => {
  const client = new Client({ connectionString: databaseUrl });
  const db = client as unknown as ProjectMapDb;
  const schema = `project_map_test_${randomUUID().replaceAll("-", "")}`;
  const workspaceId = randomUUID();
  const environmentId = randomUUID();
  const scope = { workspaceId, environmentId };

  async function createTask(status: string): Promise<string> {
    const taskId = randomUUID();
    await client.query("INSERT INTO tasks(id, environment_id, title, status) VALUES ($1, $2, $3, $4)", [taskId, environmentId, `Task ${status}`, status]);
    return taskId;
  }

  // Runs the operations the way the Master's tool does: all or nothing.
  async function apply(operations: ProjectMapOperation[]) {
    await client.query("BEGIN");
    try {
      const result = await applyProjectMapOperations(db, scope, operations);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE workspaces(id uuid PRIMARY KEY);
      CREATE TABLE environments(id uuid PRIMARY KEY);
      CREATE TABLE users(id uuid PRIMARY KEY, display_name text);
      CREATE TABLE tasks(id uuid PRIMARY KEY, environment_id uuid, title text, status text, updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
        parent_task_id uuid, workflow_parent_task_id uuid, is_hidden boolean DEFAULT false, is_incognito boolean DEFAULT false,
        trashed_at timestamptz);
      CREATE TABLE project_masters(environment_id uuid PRIMARY KEY, task_id uuid);`);
    for (const migration of ["089_task_folders.sql", "161_project_map.sql"]) {
      await client.query(await readFile(new URL(`../../../../../db/migrations/${migration}`, import.meta.url), "utf8"));
    }
    await client.query("INSERT INTO workspaces VALUES ($1)", [workspaceId]);
    await client.query("INSERT INTO environments VALUES ($1)", [environmentId]);
  });

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("builds nested folders from refs in one call and rolls task status up the tree", async () => {
    const running = await createTask("running");
    const waiting = await createTask("awaiting_input");
    const created = await apply([
      op({ op: "create_folder", ref: "billing", name: "Billing v2", text: "Ship invoices by Friday." }),
      op({ op: "create_folder", ref: "backend", name: "Backend", parent_id: "billing" }),
      op({ op: "create_card", name: "Pricing copy", parent_id: "billing", state: "next" }),
      op({ op: "move", ids: [running, waiting], parent_id: "backend" }),
      op({ op: "set_note", text: "Goal: billing v2." })
    ]);

    const map = await loadProjectMap(db, environmentId);
    const billing = map.folders.find((folder) => folder.name === "Billing v2")!;
    const backend = map.folders.find((folder) => folder.name === "Backend")!;
    expect(created.filter((item) => item.id).map((item) => [item.op, item.id])).toEqual([
      ["create_folder", billing.id], ["create_folder", backend.id], ["create_card", map.cards[0].id]
    ]);
    expect(backend.parentFolderId).toBe(billing.id);
    expect(billing.note).toBe("Ship invoices by Friday.");
    expect(map.brief).toBe("Goal: billing v2.");
    expect(map.cards).toMatchObject([{ title: "Pricing copy", folderId: billing.id, state: "next" }]);
    expect(map.tasks.filter((task) => task.folderId === backend.id).map((task) => task.id).sort()).toEqual([running, waiting].sort());
    expect(buildProjectMapRollups(map).get(billing.id)).toEqual({ active: 1, needs_input: 1, failed: 0, done: 0 });
  });

  it("leaves the map unchanged when any operation fails, and says which one", async () => {
    const before = await loadProjectMap(db, environmentId);
    await expect(apply([
      op({ op: "create_folder", name: "Docs" }),
      op({ op: "rename_folder", id: randomUUID(), name: "Nope" })
    ])).rejects.toThrow(/Operation 2 \(rename_folder\) failed: Folder not found/);
    expect((await loadProjectMap(db, environmentId)).folders).toEqual(before.folders);
  });

  it("refuses to move a folder into its own subfolder", async () => {
    const map = await loadProjectMap(db, environmentId);
    const billing = map.folders.find((folder) => folder.name === "Billing v2")!;
    const backend = map.folders.find((folder) => folder.name === "Backend")!;
    await expect(apply([op({ op: "move", ids: [billing.id], parent_id: backend.id })])).rejects.toThrow(/its own subfolder/);
  });

  it("moves a deleted folder's subfolders, cards and tasks up to its parent", async () => {
    const map = await loadProjectMap(db, environmentId);
    const billing = map.folders.find((folder) => folder.name === "Billing v2")!;
    await client.query("BEGIN");
    await deleteProjectFolder(db, environmentId, billing.id);
    await client.query("COMMIT");
    const after = await loadProjectMap(db, environmentId);
    expect(after.folders.find((folder) => folder.name === "Backend")?.parentFolderId).toBeNull();
    expect(after.cards.map((card) => card.folderId)).toEqual([null]);
  });

  it("serializes opposing folder moves and rejects the second move after rechecking ancestry", async () => {
    const created = await apply([
      op({ op: "create_folder", name: "Concurrent A" }),
      op({ op: "create_folder", name: "Concurrent B" })
    ]);
    const [a, b] = created.map((item) => item.id!);
    const peer = new Client({ connectionString: databaseUrl });
    const observer = new Client({ connectionString: databaseUrl });
    await peer.connect();
    await observer.connect();
    try {
      await peer.query(`SET search_path TO "${schema}"; SET statement_timeout TO '3s'`);
      const { rows: [{ pid }] } = await peer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await client.query("BEGIN");
      await moveProjectMapItems(db, environmentId, [a], b);
      await peer.query("BEGIN");
      let settled = false;
      const second = moveProjectMapItems(peer, environmentId, [b], a)
        .then(() => null, (error: unknown) => error)
        .finally(() => { settled = true; });
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !settled; attempt++) {
        const result = await observer.query<{ blocked: boolean }>("SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked", [pid]);
        if (result.rows[0].blocked) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await client.query("COMMIT");
      const failure = await second;
      await peer.query("ROLLBACK");
      expect(blocked).toBe(true);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/own subfolder/);
      const map = await loadProjectMap(db, environmentId);
      expect(map.folders.find((folder) => folder.id === a)?.parentFolderId).toBe(b);
      expect(map.folders.find((folder) => folder.id === b)?.parentFolderId).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      await peer.query("ROLLBACK");
      await peer.end();
      await observer.end();
    }
  });

  it("queues member edits only for projects with a Master, and delivers each once", async () => {
    const userId = randomUUID();
    await client.query("INSERT INTO users(id, display_name) VALUES ($1, 'Robin')", [userId]);
    await recordProjectMapChange(db, { environmentId, actorUserId: userId, summary: "edited the project brief" });
    expect(await claimProjectMapChanges(db, environmentId)).toEqual([]);

    await client.query("INSERT INTO project_masters VALUES ($1, $2)", [environmentId, randomUUID()]);
    await recordProjectMapChange(db, { environmentId, actorUserId: userId, summary: "edited the project brief" });
    expect(await claimProjectMapChanges(db, environmentId)).toEqual([{ actorName: "Robin", summary: "edited the project brief" }]);
    expect(await claimProjectMapChanges(db, environmentId)).toEqual([]);
  });
});

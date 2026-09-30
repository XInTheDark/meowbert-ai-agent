import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConversationNavigation, saveConversationSnapshots, cloneConversationSnapshots } from "@meowbert/shared";
import { loadConversationSnapshotArchive, stubConversationSnapshotArchive, restoreConversationSnapshotArchive } from "@meowbert/shared";

// Supply a disposable PostgreSQL database; each run uses and removes its own schema.
const databaseUrl = process.env.TEST_CONVERSATION_DATABASE_URL;
describe.skipIf(!databaseUrl)("conversation snapshots in PostgreSQL", () => {
  const client = new Client({ connectionString: databaseUrl });
  const schema = `organization_test_${randomUUID().replaceAll("-", "")}`;
  const taskId = randomUUID();
  const cloneTaskId = randomUUID();
  const ids = Array.from({ length: 322 }, () => randomUUID());
  const graph = { nodes: [{ id: ids[1], parent_id: null, topic_id: null }], topics: [], main_path_end_id: ids[1] };

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE tasks(id uuid PRIMARY KEY);
      CREATE TABLE task_messages(id uuid PRIMARY KEY, task_id uuid REFERENCES tasks(id), parent_message_id uuid REFERENCES task_messages(id),
        role text, content_json jsonb, created_at timestamptz DEFAULT now());`);
    await client.query(await readFile(new URL("../../../../../db/migrations/122_conversation_organization.sql", import.meta.url), "utf8"));
    await client.query("INSERT INTO tasks VALUES ($1), ($2)", [taskId, cloneTaskId]);
    for (let index = 0; index < 320; index++) await client.query(
      "INSERT INTO task_messages(id,task_id,parent_message_id,role,content_json) VALUES ($1,$2,$3,$4,$5)",
      [ids[index], taskId, ids[index - 1] ?? null, index % 2 ? "assistant" : "user", JSON.stringify({ text: `Message ${index + 1}` })]);
    await saveConversationSnapshots(client, taskId, ids[1], [
      { kind: "outline", payload_json: { markdown: `[Start](#message-${ids[1]})` } }, { kind: "map", payload_json: graph }
    ]);
    await saveConversationSnapshots(client, taskId, ids[319], [
      { kind: "outline", payload_json: { markdown: "Later reorganization" } },
      { kind: "map", payload_json: { ...graph, nodes: [...graph.nodes, { id: ids[319], parent_id: ids[1], topic_id: null }], main_path_end_id: ids[319] } }
    ]);
  });

  afterAll(async () => { await client.query(`DROP SCHEMA "${schema}" CASCADE`); await client.end(); });

  it("reads the latest independent snapshots and indexes turns beyond the chat window", async () => {
    const navigation = await loadConversationNavigation(client, taskId, ids[319]);
    expect(navigation.turns).toHaveLength(160);
    expect(navigation.turns[0].id).toBe(ids[1]);
    expect(navigation.outline?.markdown).toBe("Later reorganization");
    expect(navigation.map?.graph.main_path_end_id).toBe(ids[319]);
  });

  it("regenerates turn five without applying later snapshots from another branch", async () => {
    await client.query("INSERT INTO task_messages(id,task_id,parent_message_id,role,content_json) VALUES ($1,$2,$3,'assistant',$4)",
      [ids[320], taskId, ids[8], JSON.stringify({ text: "Regenerated turn five" })]);
    const navigation = await loadConversationNavigation(client, taskId, ids[320]);
    expect(navigation.turns).toHaveLength(5);
    expect(navigation.map?.graph).toEqual(graph);
    expect(navigation.outline?.message_id).toBe(ids[1]);
  });

  it("copies the effective organization with remapped IDs into a separate thread", async () => {
    await client.query("INSERT INTO task_messages(id,task_id,role,content_json) VALUES ($1,$2,'assistant',$3)", [ids[321], cloneTaskId, JSON.stringify({ text: "Cloned" })]);
    await cloneConversationSnapshots(client, { sourceTaskId: taskId, sourceLeafId: ids[1], targetTaskId: cloneTaskId, ids: new Map([[ids[1], ids[321]]]) });
    const navigation = await loadConversationNavigation(client, cloneTaskId, ids[321]);
    expect(navigation.map?.graph.nodes[0].id).toBe(ids[321]);
    expect(navigation.outline?.markdown).toContain(ids[321]);
  });

  it("retains earlier organization when regenerating inside a cloned thread", async () => {
    const cloned = new Map(ids.slice(0, 320).map((id) => [id, randomUUID()]));
    for (let index = 0; index < 320; index++) await client.query(
      "INSERT INTO task_messages(id,task_id,parent_message_id,role,content_json) VALUES ($1,$2,$3,$4,$5)",
      [cloned.get(ids[index]), cloneTaskId, cloned.get(ids[index - 1]) ?? null, index % 2 ? "assistant" : "user", JSON.stringify({ text: "Cloned" })]);
    await cloneConversationSnapshots(client, { sourceTaskId: taskId, sourceLeafId: ids[319], targetTaskId: cloneTaskId, ids: cloned });
    expect((await loadConversationNavigation(client, cloneTaskId, cloned.get(ids[8])!)).outline?.markdown).toContain(cloned.get(ids[1]));
    expect((await loadConversationNavigation(client, cloneTaskId, cloned.get(ids[319])!)).outline?.markdown).toBe("Later reorganization");
  });

  it("restores snapshot payloads and accepts older archives without snapshots", async () => {
    const before = await loadConversationNavigation(client, taskId, ids[319]);
    const archive = await loadConversationSnapshotArchive(client, taskId);
    await stubConversationSnapshotArchive(client, taskId);
    await restoreConversationSnapshotArchive(client, undefined);
    await restoreConversationSnapshotArchive(client, archive);
    expect(await loadConversationNavigation(client, taskId, ids[319])).toEqual(before);
  });
});

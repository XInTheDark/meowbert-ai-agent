import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTaskArchive, readTaskArchive } from "./task-history-archive-format.js";
import { readTaskHistoryPayloads } from "./task-history-payload-reader.js";
import type { TaskHistoryArchiveDeps, TaskHistoryArchiveDocument } from "./task-history-archive.js";

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "archive-chunks-")); directories.push(rootPath);
  const config = { enabled: true, rootPath, mountPath: rootPath, archivesDir: "history" };
  const task = { id: randomUUID(), workspace_id: randomUUID(), environment_id: randomUUID(), archived_at: new Date().toISOString(), last_active_at: new Date().toISOString() };
  const document: TaskHistoryArchiveDocument = { version: 2, task, events: [], message_revisions: [],
    messages: Array.from({ length: 260 }, (_, index) => ({ id: randomUUID(), content_json: { text: `message ${index}` }, token_usage_json: null })),
    context: { history: [{ id: randomUUID(), payload_json: { secret: "private context" } }], notes: [] },
    media: [{ sha256: "media-hash", mime_type: "image/png", bytes_base64: "YWJj" },
      { sha256: "another-hash", mime_type: "image/png", bytes_base64: "ZGVm" }] };
  return { config, document };
}

describe("archive chunk reads", () => {
  it("returns bounded cold message previews without changing full payload reads", async () => {
    const { config, document } = await fixture();
    const message = document.messages[0];
    message.content_json = { text: "Inventory requirements ".repeat(100), turn_summary: "Inventory", response_items: ["x".repeat(2_000_000)] };
    message.token_usage_json = { total_tokens: 50_000 };
    const archived = await writeTaskArchive(config, document);
    const ref = archived.references.find((item) => item.payload_id === message.id)!;
    const query = async () => ({ rows: [{ ...ref, task_history_state: "warm" }], rowCount: 1 });
    const deps = { archiveConfig: config, db: { query } } as unknown as TaskHistoryArchiveDeps;
    const rows = [{ id: message.id, role: "user", content_json: { text: "" } }];

    const preview = await readTaskHistoryPayloads(document.task.id, "messages", rows, deps, "message_preview");
    expect(preview).toEqual([{ id: message.id, role: "user", content_json: {
      text: String(message.content_json.text).slice(0, 500), turn_summary: "Inventory"
    } }]);
    expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThan(1_000);
    expect((await readTaskHistoryPayloads(document.task.id, "messages", rows, deps))[0]).toEqual({ ...rows[0], ...message });
  });
  it("reads one requested message without loading execution or other message chunks or restoring SQL payloads", async () => {
    const { config, document } = await fixture();
    const archived = await writeTaskArchive(config, document);
    const message = document.messages[130];
    const ref = archived.references.find((item) => item.payload_id === message.id)!;
    // Remove every unrelated chunk: a page read must still work.
    for (const key of new Set(archived.references.map((item) => item.archive_key))) if (key !== ref.archive_key) await fs.rm(path.join(config.rootPath, key));
    const query = vi.fn(async () => ({ rows: [{ ...ref, task_history_state: "archived", task_history_archive_key: archived.archiveKey }], rowCount: 1 }));
    const deps = { archiveConfig: config, db: { query } } as unknown as TaskHistoryArchiveDeps;
    const rows = await readTaskHistoryPayloads(document.task.id, "messages", [{ id: message.id, content_json: { text: "" }, role: "assistant" }], deps);
    expect(rows[0].content_json).toEqual(message.content_json);
    expect(rows[0].role).toBe("assistant");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^SELECT/);
    rows[0].content_json.text = "changed by caller";
    expect((await readTaskHistoryPayloads(document.task.id, "messages", [{ id: message.id, content_json: {} }], deps))[0].content_json).toEqual(message.content_json);
  });
  it("round trips all sections and reuses immutable chunks", async () => {
    const { config, document } = await fixture();
    const first = await writeTaskArchive(config, document);
    const stats = await fs.stat(path.join(config.rootPath, first.references[0].archive_key));
    const second = await writeTaskArchive(config, { ...document, task: { ...document.task, archived_at: new Date(Date.now() + 1).toISOString() } });
    expect(second.references).toEqual(first.references);
    expect((await fs.stat(path.join(config.rootPath, first.references[0].archive_key))).mtimeMs).toBe(stats.mtimeMs);
    const restored = await readTaskArchive(config, first.archiveKey);
    expect(restored.messages).toEqual(document.messages);
    expect(restored.context).toEqual({ ...document.context, windowPrompts: [], windowRequests: [] });
    expect(restored.media).toEqual(document.media);
  });
  it("rejects a chunk from another task instead of returning empty content", async () => {
    const { config, document } = await fixture();
    const archived = await writeTaskArchive(config, document);
    const ref = archived.references[0];
    const query = async () => ({ rows: [{ ...ref, task_history_state: "warm" }], rowCount: 1 });
    await expect(readTaskHistoryPayloads(randomUUID(), "messages", [{ id: ref.payload_id }],
      { archiveConfig: config, db: { query } } as unknown as TaskHistoryArchiveDeps)).rejects.toThrow("does not belong");
  });
  it("reads one media blob without opening unrelated media or execution chunks", async () => {
    const { config, document } = await fixture();
    const archived = await writeTaskArchive(config, document);
    const blob = document.media![0];
    const ref = archived.references.find((item) => item.payload_id === blob.sha256)!;
    for (const key of new Set(archived.references.map((item) => item.archive_key))) if (key !== ref.archive_key) await fs.rm(path.join(config.rootPath, key));
    const query = async () => ({ rows: [{ ...ref, task_history_state: "warm" }], rowCount: 1 });
    const result = await readTaskHistoryPayloads(document.task.id, "media", [{ sha256: blob.sha256 }],
      { archiveConfig: config, db: { query } } as unknown as TaskHistoryArchiveDeps);
    expect(result).toEqual([blob]);
  });
  it("rejects corrupted bytes rather than treating them as empty history", async () => {
    const { config, document } = await fixture();
    const archived = await writeTaskArchive(config, document);
    const ref = archived.references[0];
    await fs.writeFile(path.join(config.rootPath, ref.archive_key), "corrupted archive");
    const query = vi.fn(async () => ({ rows: [{ ...ref, task_history_state: "warm" }], rowCount: 1 }));
    await expect(readTaskHistoryPayloads(document.task.id, "messages", [{ id: ref.payload_id }],
      { archiveConfig: config, db: { query } } as unknown as TaskHistoryArchiveDeps)).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";
import { copyTaskMediaBlobs, externalizeTaskMedia, rehydrateTaskMedia, TASK_MEDIA_REFERENCE_PREFIX } from "./task-media-blobs.js";
import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";

interface StoredBlob { task_id: string; sha256: string; mime_type: string; bytes: Buffer }

function createBlobStore(): TaskHistoryArchiveQueryable & { blobs: StoredBlob[] } {
  const blobs: StoredBlob[] = [];
  const has = (taskId: string, sha256: string) => blobs.some((blob) => blob.task_id === taskId && blob.sha256 === sha256);
  return {
    blobs,
    async query<T extends object>(text: string, params: unknown[] = []) {
      if (text.includes("INSERT INTO task_media_blobs") && text.includes("SELECT $2")) {
        const [source, target, hashes] = params as [string, string, string[]];
        for (const blob of blobs.filter((entry) => entry.task_id === source && hashes.includes(entry.sha256))) {
          if (!has(target, blob.sha256)) blobs.push({ ...blob, task_id: target });
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("INSERT INTO task_media_blobs")) {
        const [taskId, sha256, mimeType, bytes] = params as [string, string, string, Buffer];
        if (!has(taskId, sha256)) blobs.push({ task_id: taskId, sha256, mime_type: mimeType, bytes });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("FROM task_media_blobs")) {
        const [taskId, hashes] = params as [string, string[]];
        const rows = blobs.filter((blob) => blob.task_id === taskId && hashes.includes(blob.sha256));
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };
}

const photo = `data:image/jpeg;base64,${Buffer.from("jpeg-bytes-".repeat(50)).toString("base64")}`;

function viewedImageContent(): Record<string, unknown> {
  return {
    text: "Marked it.",
    response_items: [
      { type: "function_call", call_id: "call_1", name: "view_image", arguments: "{}" },
      { role: "user", content: [{ type: "input_image", detail: "high", image_url: photo }] },
      { role: "user", content: [{ type: "input_image", detail: "high", image_url: photo }] }
    ]
  };
}

describe("task media blobs", () => {
  it("stores a viewed image once and replays the identical data URL", async () => {
    const db = createBlobStore();
    const original = viewedImageContent();
    const stored = await externalizeTaskMedia(db, "task-1", original);

    expect(JSON.stringify(stored)).not.toContain(photo);
    expect(JSON.stringify(stored)).toContain(TASK_MEDIA_REFERENCE_PREFIX);
    expect(db.blobs).toHaveLength(1);
    expect(original).toEqual(viewedImageContent());

    const [replayed] = await rehydrateTaskMedia(db, "task-1", [{ id: "m1", content_json: stored }]);
    expect(replayed.content_json).toEqual(original);
  });

  it("replaces media whose blob is gone with a note instead of a broken reference", async () => {
    const db = createBlobStore();
    const stored = await externalizeTaskMedia(db, "task-1", viewedImageContent());
    db.blobs.length = 0;

    const [replayed] = await rehydrateTaskMedia(db, "task-1", [{ content_json: stored }]);
    const items = replayed.content_json.response_items as Array<{ content?: unknown[] }>;
    expect(items[1].content).toEqual([{ type: "input_text", text: expect.stringContaining("no longer available") }]);
    expect(JSON.stringify(replayed)).not.toContain(TASK_MEDIA_REFERENCE_PREFIX);
  });

  it("copies referenced media to a forked task so its replay still works", async () => {
    const db = createBlobStore();
    const stored = await externalizeTaskMedia(db, "task-1", viewedImageContent());
    await copyTaskMediaBlobs(db, { sourceTaskId: "task-1", targetTaskId: "fork-1", contents: [stored] });

    const [replayed] = await rehydrateTaskMedia(db, "fork-1", [{ content_json: stored }]);
    expect(replayed.content_json).toEqual(viewedImageContent());
  });
});

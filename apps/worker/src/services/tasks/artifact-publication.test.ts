import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn().mockResolvedValue(undefined) }));
import { artifactVisibility, publishPendingArtifactsOnce, type PendingArtifact } from "./artifact-publication.js";
import { query } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";

let root: string;
let artifact: PendingArtifact;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-artifact-")));
  await fs.mkdir(path.join(root, "task"));
  artifact = { id: "a", task_id: "t", root_path: root, task_root_path: "task", relative_path: "out.txt",
    size_bytes: "5", sha256: createHash("sha256").update("hello").digest("hex"), publication_attempts: 0,
    publication_deadline_at: new Date(Date.now() + 60_000).toISOString() };
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it("keeps delayed outputs pending then publishes only complete matching bytes", async () => {
  expect(await artifactVisibility(artifact)).toBe("pending");
  await fs.writeFile(path.join(root, "task/out.txt"), "hel");
  expect(await artifactVisibility(artifact)).toBe("pending");
  await fs.writeFile(path.join(root, "task/out.txt"), "hello");
  expect(await artifactVisibility(artifact)).toBe("available");
});

it("marks timed-out, corrupt and escaped files missing", async () => {
  expect(await artifactVisibility(artifact, Date.now() + 120_000)).toBe("missing");
  await fs.writeFile(path.join(root, "task/out.txt"), "wrong");
  expect(await artifactVisibility(artifact)).toBe("missing");
  await fs.writeFile(path.join(root, "secret"), "hello");
  await fs.symlink(path.join(root, "secret"), path.join(root, "task/escape"));
  expect(await artifactVisibility({ ...artifact, relative_path: "escape" })).toBe("missing");
});

it("persists visibility and notifies the UI after publication", async () => {
  await fs.writeFile(path.join(root, "task/out.txt"), "hello");
  vi.mocked(query).mockResolvedValueOnce({ rows: [artifact] } as never).mockResolvedValue({ rows: [{ id: "a" }], rowCount: 1 } as never);
  await publishPendingArtifactsOnce();
  expect(query).toHaveBeenLastCalledWith(expect.any(String), ["a", "available", 1_000]);
  expect(emitTaskEvent).toHaveBeenCalledWith("t", "artifact", { publicationState: "available", relativePath: "out.txt" });
});

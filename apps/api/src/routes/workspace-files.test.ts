import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../services/workspaces/workspace-access.js", () => ({ assertWorkspaceMember: vi.fn(async () => undefined) }));
vi.mock("../services/workspaces/workspace-storage.js", () => ({
  ensureWorkspaceStorageRoot: vi.fn(async (workspace: { root_path: string }) => workspace.root_path)
}));
vi.mock("../services/workspaces/workspace-storage-usage.js", () => ({
  getWorkspaceStorageUsage: vi.fn(async () => ({ usedBytes: 0, limitBytes: null, availableBytes: null, usagePercent: null, isOverLimit: false }))
}));
vi.mock("../services/users/resource-limits.js", () => ({ resolveWorkspaceStorageLimitBytes: vi.fn(async () => null) }));

import { query } from "../lib/db.js";
import { resolveWorkspaceStorageLimitBytes } from "../services/users/resource-limits.js";
import { getWorkspaceStorageUsage } from "../services/workspaces/workspace-storage-usage.js";
import { workspaceFileRoutes } from "./workspace-files.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const base = `/api/workspaces/${WORKSPACE_ID}/files`;
let rootPath = "";

async function createApp() {
  const app = Fastify();
  await app.register(multipart);
  app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
    request.user = { id: "user-1", email: "user@example.com" };
  });
  await app.register(workspaceFileRoutes);
  return app;
}

beforeEach(async () => {
  rootPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-workspace-files-")));
  await fs.mkdir(path.join(rootPath, "docs"));
  await fs.writeFile(path.join(rootPath, "docs", "notes.txt"), "hello notes");
  await fs.writeFile(path.join(rootPath, "a.txt"), "alpha");
  vi.mocked(query).mockResolvedValue({ rows: [{ id: WORKSPACE_ID, root_path: rootPath }], rowCount: 1 } as unknown as QueryResult);
});

afterEach(async () => {
  await fs.rm(rootPath, { recursive: true, force: true });
});

describe("workspace file routes", () => {
  it("lists folders before files and previews text content", async () => {
    const app = await createApp();

    const listing = await app.inject({ method: "GET", url: base });
    expect(listing.statusCode).toBe(200);
    expect(listing.json()).toMatchObject({
      cwd: "",
      parentPath: null,
      items: [
        { name: "docs", kind: "directory", relativePath: "docs" },
        { name: "a.txt", kind: "file", relativePath: "a.txt", sizeBytes: 5 }
      ]
    });

    const nested = await app.inject({ method: "GET", url: `${base}?path=docs` });
    expect(nested.json()).toMatchObject({ cwd: "docs", parentPath: "", items: [{ relativePath: "docs/notes.txt" }] });

    const preview = await app.inject({ method: "GET", url: `${base}/content?path=docs/notes.txt` });
    expect(preview.json()).toEqual({
      relativePath: "docs/notes.txt",
      sizeBytes: 11,
      truncated: false,
      encoding: "utf-8",
      text: "hello notes"
    });
  });

  it("downloads a file directly and folders or selections as zips", async () => {
    const app = await createApp();

    const file = await app.inject({ method: "GET", url: `${base}/download?path=a.txt` });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''a.txt");
    expect(file.body).toBe("alpha");

    const folder = await app.inject({ method: "GET", url: `${base}/download?path=docs` });
    expect(folder.headers["content-type"]).toBe("application/zip");
    expect(folder.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''docs.zip");
    expect(folder.rawPayload.subarray(0, 2).toString()).toBe("PK");

    const batch = await app.inject({ method: "GET", url: `${base}/download/batch?path=a.txt&path=docs` });
    expect(batch.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''selected-files.zip");
    expect(batch.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });

  it("uploads into a folder and deletes selections that overlap", async () => {
    const app = await createApp();
    const form = new FormData();
    form.append("file", new Blob(["uploaded"]), "a.txt");

    const upload = await app.inject({ method: "POST", url: `${base}/upload?path=docs`, payload: form });
    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({ file: { name: "a.txt", relativePath: "docs/a.txt", sizeBytes: 8 } });

    const deleted = await app.inject({
      method: "POST",
      url: `${base}/delete`,
      payload: { paths: ["docs", "docs/notes.txt"] }
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ deletedCount: 1, deletedPaths: ["docs"] });
    await expect(fs.readdir(rootPath)).resolves.toEqual(["a.txt"]);
  });

  it("refuses uploads that would exceed the workspace storage limit", async () => {
    vi.mocked(resolveWorkspaceStorageLimitBytes).mockResolvedValue(20);
    vi.mocked(getWorkspaceStorageUsage).mockResolvedValue({
      usedBytes: 10, limitBytes: 20, availableBytes: 10, usagePercent: 50, isOverLimit: false
    });
    const app = await createApp();
    const upload = (content: string) => {
      const form = new FormData();
      form.append("file", new Blob([content]), "upload.txt");
      return app.inject({ method: "POST", url: `${base}/upload`, payload: form });
    };

    const tooBig = await upload("x".repeat(15));
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.body).toContain("Not enough workspace storage");
    await expect(fs.readdir(rootPath)).resolves.toEqual(["a.txt", "docs"]);

    const fits = await upload("x".repeat(5));
    expect(fits.statusCode).toBe(201);

    vi.mocked(getWorkspaceStorageUsage).mockResolvedValue({
      usedBytes: 20, limitBytes: 20, availableBytes: 0, usagePercent: 100, isOverLimit: false
    });
    const full = await upload("x");
    expect(full.statusCode).toBe(413);
    expect(full.body).toContain("Workspace storage is full");
  });
});

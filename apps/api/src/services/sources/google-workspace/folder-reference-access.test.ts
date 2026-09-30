import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), fetch: vi.fn() }));
vi.mock("../../../lib/db.js", () => ({ query: mocks.query }));
vi.mock("../source-access.js", () => ({ resolveWorkspaceSourceAccess: mocks.access }));

import { resolveGoogleWorkspaceFolderReference } from "./folder-reference-access.js";

const input = { taskId: "task-1", workspaceId: "workspace-1", sourceId: "google-drive", itemReference: "doc-1" };
const files: Record<string, object> = {
  "doc-1": { id: "doc-1", name: "Brief", mimeType: "application/vnd.google-apps.document", parents: ["subfolder"], webViewLink: "https://docs.google.com/document/d/doc-1/edit" },
  subfolder: { id: "subfolder", name: "Subfolder", mimeType: "application/vnd.google-apps.folder", parents: ["root-folder"] },
  "root-folder": { id: "root-folder", name: "Notes", mimeType: "application/vnd.google-apps.folder", parents: ["drive-root"] }
};

describe("Google Workspace folder access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ environment_id: "project-1", remote_item_id: "root-folder" }] });
    mocks.access.mockResolvedValue({ accessToken: "oauth-token" });
    mocks.fetch.mockImplementation(async (url: URL) => {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      return new Response(JSON.stringify(files[id] ?? { id, name: id, mimeType: "application/vnd.google-apps.folder", parents: [] }));
    });
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("resolves a nested document using only its ancestor metadata", async () => {
    await expect(resolveGoogleWorkspaceFolderReference(input)).resolves.toMatchObject({
      itemId: "doc-1", name: "Brief", mimeType: "application/vnd.google-apps.document",
      scope: { environmentId: "project-1", workspaceId: "workspace-1" }
    });
    expect(mocks.fetch.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/drive/v3/files/doc-1", "/drive/v3/files/subfolder", "/drive/v3/files/root-folder"
    ]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("l.task_id = t.id"), ["task-1", "workspace-1", "google-drive"]);
  });

  it("rejects a detached folder before accessing Google", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(resolveGoogleWorkspaceFolderReference(input)).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects a document moved outside all attached folders", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...files["doc-1"], parents: ["elsewhere"] })));
    await expect(resolveGoogleWorkspaceFolderReference(input)).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["doc-1", "subfolder", "root-folder"])("rejects a trashed target or ancestor: %s", async (trashedId) => {
    mocks.fetch.mockImplementation(async (url: URL) => {
      const id = url.pathname.split("/").at(-1)!;
      return new Response(JSON.stringify({ ...files[id], trashed: id === trashedId }));
    });
    await expect(resolveGoogleWorkspaceFolderReference(input)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("terminates cyclic ancestry without granting access", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...files["doc-1"], parents: ["doc-1"] })));
    await expect(resolveGoogleWorkspaceFolderReference(input)).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("passes resource keys to metadata lookup without returning OAuth credentials", async () => {
    const reference = await resolveGoogleWorkspaceFolderReference({ ...input, itemReference: "doc-1::resourceKey::key-1" });
    expect(mocks.fetch.mock.calls[0][1].headers).toMatchObject({ "x-goog-drive-resource-keys": "doc-1/key-1" });
    expect(reference.resourceKey).toBe("key-1");
    expect(JSON.stringify(reference)).not.toContain("oauth-token");
  });

  it("rejects ordinary files and metadata failures", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...files["doc-1"], mimeType: "text/plain" })));
    await expect(resolveGoogleWorkspaceFolderReference(input)).rejects.toMatchObject({ statusCode: 400 });
    mocks.fetch.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(resolveGoogleWorkspaceFolderReference(input)).rejects.toMatchObject({ statusCode: 502 });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveAccess, canWrite } = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  canWrite: vi.fn()
}));
vi.mock("../source-access.js", () => ({ resolveWorkspaceSourceAccess: resolveAccess }));
vi.mock("../workspace-source-connections.js", () => ({ sourceConnectionCanWrite: canWrite }));

import { executeGoogleWorkspaceProxyRequest } from "./proxy-request.js";

describe("executeGoogleWorkspaceProxyRequest", () => {
  beforeEach(() => {
    resolveAccess.mockResolvedValue({
      accessToken: "stored-google-token",
      connection: { provider: "google-drive" }
    });
    canWrite.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "Google rejected the request" } }),
      { status: 400, headers: { "content-type": "application/json" } }
    )));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds the stored token and preserves Google error responses for googleapiclient", async () => {
    const result = await executeGoogleWorkspaceProxyRequest({
      workspaceId: "workspace-1",
      reference: {
        version: 1,
        kind: "google_workspace_reference",
        sourceId: "google-drive",
        provider: "google-drive",
        itemReference: "doc-1::resourceKey::key-1",
        itemId: "doc-1",
        resourceKey: "key-1",
        name: "Brief",
        mimeType: "application/vnd.google-apps.document",
        webUrl: null,
        scope: {
          kind: "project",
          workspaceId: "workspace-1",
          environmentId: "project-1",
          taskId: null
        }
      },
      request: {
        method: "POST",
        url: new URL("https://docs.googleapis.com/v1/documents/doc-1:batchUpdate"),
        headers: { "content-type": "application/json" },
        body: Buffer.from("{}"),
        mutating: true
      }
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer stored-google-token",
      "x-goog-drive-resource-keys": "doc-1/key-1"
    });
    expect(result.status).toBe(400);
    expect(Buffer.from(result.bodyBase64, "base64").toString("utf8")).toContain("Google rejected");
  });

  it("requires write-capable Source access for mutations", async () => {
    canWrite.mockReturnValueOnce(false);
    await expect(executeGoogleWorkspaceProxyRequest({
      workspaceId: "workspace-1",
      reference: {
        version: 1,
        kind: "google_workspace_reference",
        sourceId: "google-drive",
        provider: "google-drive",
        itemReference: "doc-1",
        itemId: "doc-1",
        resourceKey: null,
        name: "Brief",
        mimeType: "application/vnd.google-apps.document",
        webUrl: null,
        scope: {
          kind: "project",
          workspaceId: "workspace-1",
          environmentId: "project-1",
          taskId: null
        }
      },
      request: {
        method: "POST",
        url: new URL("https://docs.googleapis.com/v1/documents/doc-1:batchUpdate"),
        headers: {},
        body: undefined,
        mutating: true
      }
    })).rejects.toMatchObject({ statusCode: 409 });
  });
});

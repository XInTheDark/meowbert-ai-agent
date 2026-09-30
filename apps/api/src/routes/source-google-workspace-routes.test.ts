import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), fetch: vi.fn() }));
vi.mock("../lib/db.js", () => ({ query: mocks.query }));
vi.mock("../lib/config.js", () => ({ secrets: { jwtSecret: "reference-signing-test-secret" } }));
vi.mock("../services/sources/source-access.js", () => ({
  resolveWorkspaceSourceAccess: vi.fn(async () => ({ accessToken: "google-token", connection: { tokens: { scope: "https://www.googleapis.com/auth/drive" } } }))
}));
vi.mock("../services/sources/workspace-source-connections.js", () => ({ sourceConnectionCanWrite: vi.fn(() => true) }));

import { registerSourceGoogleWorkspaceRoutes } from "./source-google-workspace-routes.js";
import { issueScopedAccessTicket } from "../services/auth/scoped-access-tickets.js";

async function setup() {
  const app = Fastify();
  await app.register(fastifyJwt, { secret: "route-test-secret" });
  registerSourceGoogleWorkspaceRoutes(app);
  const { ticket } = await issueScopedAccessTicket(app, {
    scope: "source_reference_proxy", userId: "user-1", taskId: "task-1", workspaceId: "workspace-1", sourceId: "google-drive"
  });
  return { app, headers: { authorization: `Bearer ${ticket}` } };
}

describe("Google Workspace folder routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql: string, values: string[]) => ({
      rows: sql.includes("JOIN source_file_links") && values[0] === "task-1"
        ? [{ environment_id: "project-1", remote_item_id: "folder-1" }]
        : []
    }));
    mocks.fetch.mockImplementation(async (url: URL) => {
      if (url.hostname === "docs.googleapis.com") return new Response(JSON.stringify({ documentId: "doc-1", replies: [] }));
      if (url.pathname.endsWith("/export")) return new Response("office-bytes", { headers: { "content-type": "application/octet-stream" } });
      const id = url.pathname.split("/").at(-1);
      return new Response(JSON.stringify({
        id, name: id === "doc-1" ? "Brief" : "Notes",
        mimeType: id === "doc-1" ? "application/vnd.google-apps.document" : "application/vnd.google-apps.folder",
        parents: id === "doc-1" ? ["folder-1"] : []
      }));
    });
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("resolves a folder Doc, edits the original, exports Office, then denies access after detach", async () => {
    const { app, headers } = await setup();
    try {
      const resolved = await app.inject({ method: "POST", url: "/api/internal/sources/google-drive/google-workspace/resolve", headers, payload: { itemReference: "doc-1" } });
      expect(resolved.statusCode).toBe(200);
      const { referenceToken } = resolved.json().reference;
      expect(resolved.body).not.toContain("google-token");
      const edit = { referenceToken, method: "POST", url: "https://docs.googleapis.com/v1/documents/doc-1:batchUpdate", headers: { "content-type": "application/json" }, bodyBase64: Buffer.from('{"requests":[{"insertText":{"endOfSegmentLocation":{},"text":"Update"}}]}').toString("base64") };
      const edited = await app.inject({ method: "POST", url: "/api/internal/sources/google-drive/google-workspace/request", headers, payload: edit });
      expect(edited.statusCode).toBe(200);
      const forwarded = mocks.fetch.mock.calls.find(([url]) => url.hostname === "docs.googleapis.com");
      expect(forwarded?.[1]).toMatchObject({ method: "POST", headers: { authorization: "Bearer google-token" } });
      const exported = await app.inject({ method: "POST", url: "/api/internal/sources/google-drive/google-workspace/request", headers, payload: {
        referenceToken, method: "GET", url: "https://www.googleapis.com/drive/v3/files/doc-1/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      } });
      expect(exported.statusCode).toBe(200);
      expect(Buffer.from(exported.json().bodyBase64, "base64").toString()).toBe("office-bytes");
      mocks.query.mockResolvedValue({ rows: [] });
      const callsBeforeDetach = mocks.fetch.mock.calls.length;
      const denied = await app.inject({ method: "POST", url: "/api/internal/sources/google-drive/google-workspace/request", headers, payload: edit });
      expect(denied.statusCode).toBe(403);
      expect(mocks.fetch).toHaveBeenCalledTimes(callsBeforeDetach);
    } finally { await app.close(); }
  });

  it("rejects requests without a source-scoped ticket or from another task", async () => {
    const { app } = await setup();
    try {
      const route = "/api/internal/sources/google-drive/google-workspace/resolve";
      expect((await app.inject({ method: "POST", url: route, payload: { itemReference: "doc-1" } })).statusCode).toBe(401);
      const { ticket } = await issueScopedAccessTicket(app, {
        scope: "source_reference_proxy", userId: "user-1", taskId: "task-2", workspaceId: "workspace-1", sourceId: "google-drive"
      });
      expect((await app.inject({ method: "POST", url: route, headers: { authorization: `Bearer ${ticket}` }, payload: { itemReference: "doc-1" } })).statusCode).toBe(403);
      expect(mocks.fetch).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/db.js", () => ({ query: vi.fn(async () => ({ rows: [{ environment_id: "project" }] })) }));
vi.mock("../services/canvases/canvas-comments.js", () => ({
  listCanvasComments: vi.fn(async () => []), addCanvasComment: vi.fn(async () => ({ id: "saved" })), resolveCanvasComment: vi.fn(async () => null)
}));
vi.mock("../services/workspaces/workspace-access.js", () => ({ assertEnvironmentMember: vi.fn(async () => ({})), assertTaskMember: vi.fn(async () => ({})) }));
import { addCanvasComment, listCanvasComments, resolveCanvasComment } from "../services/canvases/canvas-comments.js";
import { assertEnvironmentMember, assertTaskMember } from "../services/workspaces/workspace-access.js";
import { registerCanvasCommentRoutes } from "./canvas-comment-routes.js";

const id = "326522d1-67cc-4475-92ce-a85b18556261";
const taskScope = { taskId: id, relativePath: "index.html" };
const canvasScope = { canvasId: id, relativePath: "index.html" };
const element = { tagName: "h1", selector: "#title", text: "Title", attributes: { id: "title", onclick: "bad" }, screenLabel: null };

async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const app = Fastify();
  app.decorate("authenticate", async (request) => { request.user = { id: "user", email: "" }; });
  await registerCanvasCommentRoutes(app);
  try { await run(app); } finally { await app.close(); }
}

describe("Canvas comments", () => {
  beforeEach(() => vi.clearAllMocks());
  it("checks task membership before saving validated element context", async () => withApp(async (app) => {
    const response = await app.inject({ method: "POST", url: "/api/canvas-comments", payload: { scope: taskScope, element, body: " Make this shorter " } });
    expect(response.statusCode).toBe(201);
    expect(assertTaskMember).toHaveBeenCalledWith(id, "user");
    expect(addCanvasComment).toHaveBeenCalledWith(taskScope, "user", { ...element, attributes: { id: "title" } }, "Make this shorter");
  }));
  it("loads project comments through project membership rather than a task", async () => withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: `/api/canvas-comments?${new URLSearchParams(canvasScope)}` });
    expect(response.statusCode).toBe(200);
    expect(assertEnvironmentMember).toHaveBeenCalledWith("project", "user");
    expect(assertTaskMember).not.toHaveBeenCalled();
    expect(listCanvasComments).toHaveBeenCalledWith(canvasScope);
  }));
  it("does not read or write comments when project access fails", async () => withApp(async (app) => {
    vi.mocked(assertEnvironmentMember).mockRejectedValueOnce(new Error("Access denied"));
    const response = await app.inject({ method: "POST", url: "/api/canvas-comments", payload: { scope: canvasScope, element, body: "Private" } });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(addCanvasComment).not.toHaveBeenCalled();
  }));
  it("rejects ambiguous scopes and empty anchors", async () => withApp(async (app) => {
    await app.inject({ method: "POST", url: "/api/canvas-comments", payload: { scope: { ...taskScope, canvasId: id }, element, body: "Feedback" } });
    const response = await app.inject({ method: "POST", url: "/api/canvas-comments", payload: { scope: taskScope, element: null, body: "Feedback" } });
    expect(response.statusCode).toBe(400);
    expect(addCanvasComment).not.toHaveBeenCalled();
  }));
  it("cannot resolve a comment outside its canvas and page scope", async () => withApp(async (app) => {
    const response = await app.inject({ method: "PATCH", url: `/api/canvas-comments/${id}`, payload: { scope: canvasScope, resolved: true } });
    expect(response.statusCode).toBe(404);
    expect(resolveCanvasComment).toHaveBeenCalledWith(canvasScope, id, true);
  }));
});

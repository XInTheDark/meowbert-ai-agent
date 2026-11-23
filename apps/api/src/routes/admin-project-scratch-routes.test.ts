import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../services/admin/admin-settings.js", () => ({ assertSuperAdmin: vi.fn() }));
vi.mock("../services/storage/project-scratch-priority.js", () => ({ getProjectScratchPriority: vi.fn(), updateProjectScratchPriority: vi.fn() }));
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import { getProjectScratchPriority, updateProjectScratchPriority } from "../services/storage/project-scratch-priority.js";
import { registerAdminProjectScratchRoutes } from "./admin-project-scratch-routes.js";

const projectId = "6f1d8c1e-3c8f-4c1a-9d55-1d2b9f0b6a11";
const endpoint = `/api/admin/projects/${projectId}/scratch-priority`;
const headers = { authorization: "Bearer admin" };
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  vi.resetAllMocks();
  app = Fastify();
  app.decorate("authenticate", async (request) => {
    if (request.headers.authorization !== headers.authorization) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    request.user = { id: "admin", email: "admin@example.com" };
  });
  registerAdminProjectScratchRoutes(app);
});
afterEach(async () => { await app.close(); });

describe("Admin project scratch priority routes", () => {
  it.each(["GET", "PATCH"] as const)("restricts %s to super admins", async (method) => {
    vi.mocked(assertSuperAdmin).mockRejectedValue(Object.assign(new Error("Forbidden"), { statusCode: 403 }));
    const payload = method === "PATCH" ? { scratchPriority: "high" } : undefined;
    expect((await app.inject({ method, url: endpoint, headers, payload })).statusCode).toBe(403);
    expect(getProjectScratchPriority).not.toHaveBeenCalled();
    expect(updateProjectScratchPriority).not.toHaveBeenCalled();
  });

  it("reads and saves a project's priority", async () => {
    vi.mocked(getProjectScratchPriority).mockResolvedValue({ scratchPriority: "normal" });
    expect((await app.inject({ method: "GET", url: endpoint, headers })).json()).toEqual({ scratchPriority: "normal" });
    vi.mocked(updateProjectScratchPriority).mockResolvedValue({ scratchPriority: "low" });
    await app.inject({ method: "PATCH", url: endpoint, headers, payload: { scratchPriority: "low" } });
    expect(updateProjectScratchPriority).toHaveBeenCalledWith(projectId, "low");
  });

  it.each([{ scratchPriority: "urgent" }, {}, { scratchPriority: "high", extra: true }])("rejects invalid updates before persistence", async (payload) => {
    expect((await app.inject({ method: "PATCH", url: endpoint, headers, payload })).statusCode).toBeGreaterThanOrEqual(400);
    expect(updateProjectScratchPriority).not.toHaveBeenCalled();
  });
});

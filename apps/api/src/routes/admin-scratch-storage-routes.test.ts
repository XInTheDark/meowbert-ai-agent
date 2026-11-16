import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../services/admin/admin-settings.js", () => ({ assertSuperAdmin: vi.fn() }));
vi.mock("../services/storage/admin-host-storage.js", () => ({ listAdminHostStorageOverview: vi.fn(), pruneAdminTaskEvents: vi.fn(), queueAdminTaskHistoryArchive: vi.fn(), vacuumFullAdminTaskEvents: vi.fn() }));
vi.mock("../services/storage/admin-storage.js", () => ({ TASK_HISTORY_WARM_RETENTION_DAYS_MAX: 3650, updateAdminTaskHistoryWarmRetentionDays: vi.fn() }));
vi.mock("../services/storage/admin-scratch-storage.js", () => ({ getAdminScratchStorage: vi.fn(), updateAdminScratchStorage: vi.fn() }));
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import { getAdminScratchStorage, updateAdminScratchStorage } from "../services/storage/admin-scratch-storage.js";
import { registerAdminHostStorageRoutes } from "./admin-host-storage-routes.js";

const endpoint = "/api/admin/host-storage/scratch";
const headers = { authorization: "Bearer admin" };
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  vi.resetAllMocks();
  app = Fastify();
  app.decorate("authenticate", async (request) => {
    if (request.headers.authorization !== headers.authorization) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    request.user = { id: "admin", email: "admin@example.com" };
  });
  registerAdminHostStorageRoutes(app);
});
afterEach(async () => { await app.close(); });

describe("Admin scratch storage routes", () => {
  it.each(["GET", "PATCH"] as const)("restricts %s to super admins", async (method) => {
    expect((await app.inject({ method, url: endpoint })).statusCode).toBe(401);
    vi.mocked(assertSuperAdmin).mockRejectedValue(Object.assign(new Error("Forbidden"), { statusCode: 403 }));
    expect((await app.inject({ method, url: endpoint, headers, payload: method === "PATCH" ? { limitMb: 10 } : undefined })).statusCode).toBe(403);
    expect(getAdminScratchStorage).not.toHaveBeenCalled();
    expect(updateAdminScratchStorage).not.toHaveBeenCalled();
  });
  it("reads and updates only the scratch budget", async () => {
    vi.mocked(getAdminScratchStorage).mockResolvedValue({ limitMb: 20 } as never);
    expect((await app.inject({ method: "GET", url: endpoint, headers })).json()).toEqual({ limitMb: 20 });
    await app.inject({ method: "PATCH", url: endpoint, headers, payload: { limitMb: 10 } });
    expect(updateAdminScratchStorage).toHaveBeenCalledWith(10);
    await app.inject({ method: "PATCH", url: endpoint, headers, payload: { limitMb: null } });
    expect(updateAdminScratchStorage).toHaveBeenCalledWith(null);
  });
  it.each([{ limitMb: -1 }, { limitMb: 1.5 }, {}, { limitMb: 20, workspaceStorageMb: 99 }])("rejects invalid updates before persistence", async (payload) => {
    expect((await app.inject({ method: "PATCH", url: endpoint, headers, payload })).statusCode).toBeGreaterThanOrEqual(400);
    expect(updateAdminScratchStorage).not.toHaveBeenCalled();
  });
});

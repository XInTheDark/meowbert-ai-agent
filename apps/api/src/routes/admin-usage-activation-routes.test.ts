import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/admin/admin-settings.js", () => ({ assertSuperAdmin: vi.fn() }));
vi.mock("../services/admin/admin-usage-activation.js", () => ({
  listUsageActivationSchedules: vi.fn(), saveUsageActivationSchedule: vi.fn(), removeUsageActivationSchedule: vi.fn()
}));
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import * as service from "../services/admin/admin-usage-activation.js";
import { registerAdminUsageActivationRoutes } from "./admin-usage-activation-routes.js";

const id = "11111111-1111-4111-8111-111111111111";
const path = "/api/admin/utilities/usage-activation";
const headers = { authorization: "Bearer admin" };
const input = { name: "Morning", providerId: id, model: "model-a", enabled: false, rules: [{ kind: "at", days: [1], time: "03:00" }] };
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  vi.resetAllMocks();
  app = Fastify();
  app.decorate("authenticate", async (request) => {
    if (request.headers.authorization !== headers.authorization) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    request.user = { id: "admin", email: "admin@example.com" };
  });
  registerAdminUsageActivationRoutes(app);
});
afterEach(async () => { await app.close(); });

describe("admin usage activation routes", () => {
  it.each([["GET", path], ["POST", path], ["PATCH", `${path}/${id}`], ["DELETE", `${path}/${id}`]] as const)(
    "restricts %s to authenticated super admins", async (method, url) => {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      vi.mocked(assertSuperAdmin).mockRejectedValue(Object.assign(new Error("Forbidden"), { statusCode: 403 }));
      expect((await app.inject({ method, url, headers })).statusCode).toBe(403);
      for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
    }
  );
  it("creates, updates, lists and removes schedules", async () => {
    vi.mocked(service.listUsageActivationSchedules).mockResolvedValue([]);
    expect((await app.inject({ method: "GET", url: path, headers })).json()).toEqual({ schedules: [] });
    expect((await app.inject({ method: "POST", url: path, headers, payload: input })).statusCode).toBe(201);
    expect(service.saveUsageActivationSchedule).toHaveBeenCalledWith(input);
    await app.inject({ method: "PATCH", url: `${path}/${id}`, headers, payload: { ...input, enabled: true } });
    expect(service.saveUsageActivationSchedule).toHaveBeenCalledWith({ ...input, enabled: true }, id);
    expect((await app.inject({ method: "DELETE", url: `${path}/${id}`, headers })).statusCode).toBe(204);
    expect(service.removeUsageActivationSchedule).toHaveBeenCalledWith(id);
  });
  it("rejects invalid schedules and ids before changing persistence", async () => {
    await app.inject({ method: "POST", url: path, headers, payload: { ...input, rules: [] } });
    await app.inject({ method: "PATCH", url: `${path}/invalid`, headers, payload: input });
    await app.inject({ method: "DELETE", url: `${path}/invalid`, headers });
    expect(service.saveUsageActivationSchedule).not.toHaveBeenCalled();
    expect(service.removeUsageActivationSchedule).not.toHaveBeenCalled();
  });
});

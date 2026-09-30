import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/admin/admin-settings.js", () => ({ assertSuperAdmin: vi.fn() }));
vi.mock("../services/admin/admin-ai-providers.js", () => ({
  addAdminAiProvider: vi.fn(), listAdminAiProviders: vi.fn(),
  removeAdminAiProvider: vi.fn(), selectAdminAiProvider: vi.fn()
}));

import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import * as providers from "../services/admin/admin-ai-providers.js";
import { registerAdminAiProviderRoutes } from "./admin-ai-provider-routes.js";

const providerId = "11111111-1111-4111-8111-111111111111";
const list = [{ id: providerId, baseUrl: "https://provider.test/v1", selected: true }];
let app: ReturnType<typeof Fastify>;

beforeEach(() => {
  vi.resetAllMocks();
  app = Fastify();
  app.decorate("authenticate", async (request) => {
    if (request.headers.authorization !== "Bearer admin") throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    request.user = { id: "admin", email: "admin@example.com" };
  });
  registerAdminAiProviderRoutes(app);
});
afterEach(async () => { await app.close(); });

describe("admin AI provider routes", () => {
  it.each([
    ["GET", "/api/admin/ai-providers"],
    ["POST", "/api/admin/ai-providers"],
    ["POST", `/api/admin/ai-providers/${providerId}/select`],
    ["DELETE", `/api/admin/ai-providers/${providerId}`]
  ] as const)("requires authentication and super-admin access for %s %s", async (method, url) => {
    expect((await app.inject({ method, url })).statusCode).toBe(401);
    vi.mocked(assertSuperAdmin).mockRejectedValue(Object.assign(new Error("Forbidden"), { statusCode: 403 }));
    expect((await app.inject({ method, url, headers: { authorization: "Bearer admin" } })).statusCode).toBe(403);
    for (const service of Object.values(providers)) expect(service).not.toHaveBeenCalled();
  });

  it("lists, adds, selects, and removes providers through the admin service", async () => {
    for (const service of Object.values(providers)) vi.mocked(service).mockResolvedValue(list);
    const headers = { authorization: "Bearer admin" };
    expect((await app.inject({ method: "GET", url: "/api/admin/ai-providers", headers })).json()).toEqual({ providers: list });
    const added = await app.inject({ method: "POST", url: "/api/admin/ai-providers", headers,
      payload: { baseUrl: " https://provider.test/v1 ", apiKey: " secret " } });
    expect(added.statusCode).toBe(201);
    expect(providers.addAdminAiProvider).toHaveBeenCalledWith({ baseUrl: "https://provider.test/v1", apiKey: "secret" });
    expect(added.body).not.toContain("secret");
    await app.inject({ method: "POST", url: `/api/admin/ai-providers/${providerId}/select`, headers });
    expect(providers.selectAdminAiProvider).toHaveBeenCalledWith(providerId);
    await app.inject({ method: "DELETE", url: `/api/admin/ai-providers/${providerId}`, headers });
    expect(providers.removeAdminAiProvider).toHaveBeenCalledWith(providerId);
  });

  it("rejects invalid input before writing providers", async () => {
    await app.inject({ method: "POST", url: "/api/admin/ai-providers", headers: { authorization: "Bearer admin" },
      payload: { baseUrl: "ftp://provider.test", apiKey: "key" } });
    expect(providers.addAdminAiProvider).not.toHaveBeenCalled();
  });
});

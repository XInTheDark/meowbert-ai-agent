import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../../services/workspaces/workspace-access.js", () => ({ assertTaskMember: vi.fn() }));
vi.mock("../../services/tasks/task-history.js", () => ({ ensureTaskHistoryWarm: vi.fn() }));
vi.mock("../../services/tasks/task-service/index.js", () => ({ resolveActiveLeafMessageId: vi.fn(async () => null) }));
vi.mock("@meowbert/shared", async (original) => ({ ...await original<typeof import("@meowbert/shared")>(), loadConversationNavigation: vi.fn() }));
import { query } from "../../lib/db.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { ensureTaskHistoryWarm } from "../../services/tasks/task-history.js";
import { loadConversationNavigation } from "@meowbert/shared";
import { registerTaskNavigationRoutes } from "./navigation-routes.js";

const taskId = "10000000-0000-4000-8000-000000000001";
const empty = { enabled: true, active_leaf_message_id: null, outline: null, map: null, turns: [], messages: [] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadConversationNavigation).mockResolvedValue(empty);
  vi.mocked(query).mockResolvedValue({ rows: [{ model_defaults_json: {} }] } as never);
});
async function request(suffix = "") {
  const app = Fastify();
  app.decorate("authenticate", async (req: Fastify.FastifyRequest) => { req.user = { id: taskId, email: "user@example.com" }; });
  await registerTaskNavigationRoutes(app);
  try { return await app.inject({ method: "GET", url: `/api/tasks/${taskId}/conversation/navigation${suffix}` }); }
  finally { await app.close(); }
}
describe("conversation navigation endpoint", () => {
  it("defaults on and warms history before loading snapshots", async () => {
    expect((await request()).json()).toEqual(empty);
    expect(ensureTaskHistoryWarm).toHaveBeenCalledWith(taskId);
    expect(loadConversationNavigation).toHaveBeenCalled();
  });
  it("does not read or warm organization when disabled", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ model_defaults_json: { newMessageOrganizationEnabled: false } }] } as never);
    expect((await request()).json()).toEqual({ ...empty, enabled: false });
    expect(loadConversationNavigation).not.toHaveBeenCalled();
    expect(ensureTaskHistoryWarm).not.toHaveBeenCalled();
  });
  it("checks membership before reading workspace settings", async () => {
    vi.mocked(assertTaskMember).mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { statusCode: 403 }));
    expect((await request()).statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects a leaf belonging to another task", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ model_defaults_json: {} }] } as never).mockResolvedValueOnce({ rows: [] } as never);
    expect((await request(`?activeLeafMessageId=${taskId}`)).statusCode).toBe(404);
    expect(loadConversationNavigation).not.toHaveBeenCalled();
  });
});

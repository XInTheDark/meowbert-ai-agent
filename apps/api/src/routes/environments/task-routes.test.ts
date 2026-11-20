import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../../services/task-search/query.js", () => ({ searchProjectTasks: vi.fn() }));
vi.mock("../../services/tasks/task-list.js", () => ({ listProjectTasks: vi.fn() }));
vi.mock("../../services/tasks/task-cleanup.js", () => ({ emptyEnvironmentTrash: vi.fn(), resolveTaskCleanupExpirationDays: vi.fn(), runEnvironmentTaskCleanup: vi.fn() }));
vi.mock("../../services/tasks/task-cancellation.js", () => ({ cancelTaskAndSchedules: vi.fn() }));

import { query } from "../../lib/db.js";
import { cancelTaskAndSchedules } from "../../services/tasks/task-cancellation.js";
import { registerEnvironmentTaskRoutes } from "./task-routes.js";

describe("project task bulk cancellation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the same cancellation path as a single task for every matched workflow root", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: "project-1" }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: "swarm-1" }, { id: "interrupting-1" }], rowCount: 2 } as never);
    const app = Fastify();
    app.decorate("authenticate", async (request) => { request.user = { id: "user-1", email: "user@example.com" }; });
    await registerEnvironmentTaskRoutes(app);
    const response = await app.inject({ method: "POST", url: "/api/projects/11111111-1111-4111-8111-111111111111/tasks/cancel", payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ cancelledCount: 2 });
    expect(vi.mocked(cancelTaskAndSchedules).mock.calls).toEqual([["swarm-1"], ["interrupting-1"]]);
    await app.close();
  });
});

import Fastify from "fastify";
import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../../lib/redis.js", () => ({
  createRedisSubscriber: vi.fn()
}));

vi.mock("../../services/workspaces/workspace-access.js", () => ({
  assertWorkspaceMember: vi.fn(async () => {})
}));

vi.mock("../../services/environments/personality-options.js", () => ({
  personalityDefaultId: "default",
  personalityOptions: []
}));

vi.mock("./shared.js", async () => {
  const zod = await import("zod");
  return {
    isWorkspaceOwner: vi.fn(async () => true),
    workspaceNotificationsQuerySchema: zod.z.object({
      limit: zod.coerce.number().int().min(1).max(200).default(100)
    }),
    workspaceParamsSchema: zod.z.object({ wsId: zod.z.string().uuid() })
  };
});

import { query } from "../../lib/db.js";
import { registerWorkspaceSettingsAuxRoutes } from "./settings-routes.js";

function createQueryResult<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount,
    oid: 0,
    fields: [],
    rows
  };
}

describe("registerWorkspaceSettingsAuxRoutes", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("limits workspace notification feed rows to the retention window", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "326522d1-67cc-4475-92ce-a85b18556261", email: "user@example.com" };
    });
    mockedQuery.mockResolvedValue(createQueryResult([], 0));

    await registerWorkspaceSettingsAuxRoutes(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/workspaces/326522d1-67cc-4475-92ce-a85b18556261/notifications?limit=25"
    });

    expect(response.statusCode).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("te.created_at >= now() - ($3::int * interval '1 day')"),
      ["326522d1-67cc-4475-92ce-a85b18556261", 25, 14]
    );

    await app.close();
  });
});

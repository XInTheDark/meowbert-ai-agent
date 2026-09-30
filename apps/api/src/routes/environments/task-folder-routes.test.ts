import Fastify from "fastify";
import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import { registerEnvironmentTaskFolderRoutes } from "./task-folder-routes.js";

function createQueryResult<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount,
    oid: 0,
    fields: [],
    rows
  };
}

describe("registerEnvironmentTaskFolderRoutes", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedWithTransaction.mockReset();
  });

  function createApp() {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });
    return app;
  }

  it("lists project folders with direct counts", async () => {
    mockedQuery
      .mockResolvedValueOnce(createQueryResult([{ workspace_id: "ws-1" }]))
      .mockResolvedValueOnce(createQueryResult([
        {
          id: "11111111-1111-4111-8111-111111111111",
          workspace_id: "ws-1",
          environment_id: "22222222-2222-4222-8222-222222222222",
          parent_folder_id: null,
          name: "Launch",
          sort_order: 0,
          direct_task_count: 2,
          child_folder_count: 1,
          created_at: "2026-05-22T00:00:00.000Z",
          updated_at: "2026-05-22T00:00:00.000Z"
        }
      ]));
    const app = createApp();
    await registerEnvironmentTaskFolderRoutes(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/projects/22222222-2222-4222-8222-222222222222/task-folders"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      folders: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          workspaceId: "ws-1",
          projectId: "22222222-2222-4222-8222-222222222222",
          environmentId: "22222222-2222-4222-8222-222222222222",
          parentFolderId: null,
          name: "Launch",
          sortOrder: 0,
          directTaskCount: 2,
          childFolderCount: 1,
          createdAt: "2026-05-22T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z"
        }
      ]
    });
  });

  it("moves selected top-level tasks into a folder without touching task execution state", async () => {
    mockedQuery
      .mockResolvedValueOnce(createQueryResult([{ workspace_id: "ws-1" }]))
      .mockResolvedValueOnce(createQueryResult([{ id: "33333333-3333-4333-8333-333333333333" }]))
      .mockResolvedValueOnce(createQueryResult([{ id: "44444444-4444-4444-8444-444444444444" }], 1));
    const app = createApp();
    await registerEnvironmentTaskFolderRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/projects/22222222-2222-4222-8222-222222222222/tasks/move",
      payload: {
        taskIds: ["44444444-4444-4444-8444-444444444444"],
        folderId: "33333333-3333-4333-8333-333333333333"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ movedCount: 1 });
    expect(mockedQuery.mock.calls[2]?.[0]).toContain("SET folder_id = $3");
    expect(mockedQuery.mock.calls[2]?.[0]).toContain("parent_task_id IS NULL");
    expect(mockedQuery.mock.calls[2]?.[0]).not.toContain("status =");
  });

  it("deleting a folder reparents child folders and tasks inside a transaction", async () => {
    const client = { query: vi.fn(async () => createQueryResult([])) };
    mockedQuery.mockResolvedValueOnce(createQueryResult([
      {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "ws-1",
        environment_id: "22222222-2222-4222-8222-222222222222",
        parent_folder_id: "33333333-3333-4333-8333-333333333333",
        name: "Nested",
        sort_order: 0,
        created_at: "2026-05-22T00:00:00.000Z",
        updated_at: "2026-05-22T00:00:00.000Z"
      }
    ]));
    mockedWithTransaction.mockImplementation(async (fn) => fn(client as never));
    const app = createApp();
    await registerEnvironmentTaskFolderRoutes(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/task-folders/11111111-1111-4111-8111-111111111111"
    });

    expect(response.statusCode).toBe(200);
    const calls = client.query.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(calls[0]?.[0]).toContain("UPDATE task_folders");
    expect(calls[1]?.[0]).toContain("UPDATE tasks");
    expect(calls[2]?.[0]).toContain("DELETE FROM task_folders");
  });
});

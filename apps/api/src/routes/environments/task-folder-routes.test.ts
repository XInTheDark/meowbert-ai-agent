import Fastify from "fastify";
import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  pool: { query: vi.fn() }
}));

import { pool, query, withTransaction } from "../../lib/db.js";
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

  const mockedPoolQuery = vi.mocked(pool.query) as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedWithTransaction.mockReset();
    mockedPoolQuery.mockReset();
    mockedPoolQuery.mockResolvedValue(createQueryResult([]));
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

  it("deleting a folder reparents child folders, tasks and map cards inside a transaction", async () => {
    const client = { query: vi.fn(async (sql: string) => createQueryResult(sql.includes("FOR UPDATE") ? [{ parent_folder_id: null }] : [])) };
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
    const statements = (client.query.mock.calls as unknown as Array<[string, unknown[]]>).map(([sql]) => sql);
    expect(statements.some((sql) => sql.includes("UPDATE task_folders SET parent_folder_id"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE tasks SET folder_id"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE project_map_cards SET folder_id"))).toBe(true);
    expect(statements.some((sql) => sql.includes("DELETE FROM task_folders"))).toBe(true);
    expect(statements.some((sql) => sql.includes("INSERT INTO project_map_changes"))).toBe(true);
  });

  it("rejects a parent change that would form a cycle after a concurrent move commits", async () => {
    const folderId = "11111111-1111-4111-8111-111111111111";
    const parentId = "33333333-3333-4333-8333-333333333333";
    let concurrentMoveCommitted = false;
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM environments")) {
        concurrentMoveCommitted = true;
        return createQueryResult([{ id: "22222222-2222-4222-8222-222222222222" }]);
      }
      if (sql.includes("WITH RECURSIVE")) {
        return createQueryResult(concurrentMoveCommitted ? [{ id: parentId }] : []);
      }
      if (sql.includes("FROM task_folders")) return createQueryResult([{ id: parentId }]);
      return createQueryResult([]);
    }) };
    mockedQuery.mockResolvedValueOnce(createQueryResult([{
      id: folderId, workspace_id: "ws-1", environment_id: "22222222-2222-4222-8222-222222222222",
      parent_folder_id: null, name: "A", sort_order: 0,
      created_at: "2026-05-22T00:00:00.000Z", updated_at: "2026-05-22T00:00:00.000Z"
    }]));
    mockedWithTransaction.mockImplementation(async (fn) => fn(client as never));
    const app = createApp();
    await registerEnvironmentTaskFolderRoutes(app);
    const response = await app.inject({
      method: "PATCH", url: `/api/task-folders/${folderId}`,
      payload: { parentFolderId: parentId }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain("own child");
    expect(client.query.mock.calls.some(([sql]) => sql.includes("UPDATE task_folders"))).toBe(false);
    expect(mockedWithTransaction).toHaveBeenCalledOnce();
  });
});

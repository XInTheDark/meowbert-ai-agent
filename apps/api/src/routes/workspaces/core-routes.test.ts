import Fastify from "fastify";
import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../../services/workspaces/workspace-access.js", () => ({
  assertWorkspaceMember: vi.fn(async () => {})
}));

vi.mock("../../services/workspaces/user-workspace.js", () => ({
  ensureUserHasWorkspace: vi.fn(async () => {})
}));

vi.mock("../../services/admin/admin-settings.js", () => ({
  isSuperAdmin: vi.fn(async () => false)
}));

vi.mock("../../services/storage/default-backend.js", () => ({
  getDefaultWorkspaceStorageBackendId: vi.fn(async () => null)
}));

vi.mock("../../services/workspaces/workspace-storage.js", () => ({
  ensureWorkspaceStorageRoot: vi.fn(async () => "/runtime/workspace")
}));

vi.mock("../../services/workspaces/workspace-memory.js", () => ({
  ensureWorkspaceMemoryFiles: vi.fn(async () => {})
}));

import { query, withTransaction } from "../../lib/db.js";
import { assertWorkspaceMember } from "../../services/workspaces/workspace-access.js";
import { registerWorkspaceCoreRoutes } from "./core-routes.js";

describe("registerWorkspaceCoreRoutes", () => {
  const mockedQuery = vi.mocked(query);
  const mockedAssertWorkspaceMember = vi.mocked(assertWorkspaceMember);

  function createQueryResult<T extends object>(rows: T[], rowCount = rows.length): QueryResult<T> {
    return {
      command: "SELECT",
      rowCount,
      oid: 0,
      fields: [],
      rows
    };
  }

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedAssertWorkspaceMember.mockClear();
  });

  it.each([
    { previous: {}, patch: { nativeCompactionEnabled: true }, override: undefined, enabled: true },
    { previous: {}, patch: { newMessageOrganizationEnabled: false }, override: false, enabled: false },
    { previous: { newMessageOrganizationEnabled: false }, patch: { newMessageOrganizationEnabled: true }, override: true, enabled: true },
    { previous: { newMessageOrganizationEnabled: false }, patch: { nativeCompactionEnabled: true }, override: false, enabled: false }
  ])("persists only explicit organization changes: $patch", async ({ previous, patch, override, enabled }) => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => { request.user = { id: "user", email: "user@example.com" }; });
    mockedQuery.mockImplementation(async (sql) => createQueryResult(sql.includes("FROM workspace_members") ? [{ role: "owner" }] : []));
    const transactionQuery = vi.fn(async (sql: string, params: unknown[]) => createQueryResult([{
      model_defaults_json: sql.includes("UPDATE workspace_settings") ? JSON.parse(params[1] as string) : previous,
      memory_enabled: false, run_as_root: false
    }]));
    vi.mocked(withTransaction).mockImplementation(async (fn) => fn({ query: transactionQuery } as never));
    await registerWorkspaceCoreRoutes(app);
    const response = await app.inject({ method: "PATCH", url: "/api/workspaces/11111111-1111-4111-8111-111111111111/settings", payload: patch });
    expect(response.statusCode).toBe(200);
    expect(response.json().newMessageOrganizationEnabled).toBe(enabled);
    const saved = JSON.parse(transactionQuery.mock.calls.find(([sql]) => sql.includes("UPDATE workspace_settings"))![1][1] as string);
    expect(saved.newMessageOrganizationEnabled).toBe(override);
    await app.close();
  });

  it.each([
    { previous: {}, patch: { codeModeEnabled: false }, stored: false, enabled: false },
    { previous: { codeModeEnabled: false }, patch: { codeModeEnabled: true }, stored: undefined, enabled: true },
    { previous: {}, patch: { nativeCompactionEnabled: true }, stored: undefined, enabled: true }
  ])("keeps code mode on unless disabled: $patch", async ({ previous, patch, stored, enabled }) => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => { request.user = { id: "user", email: "user@example.com" }; });
    mockedQuery.mockImplementation(async (sql) => createQueryResult(sql.includes("FROM workspace_members") ? [{ role: "owner" }] : []));
    const transactionQuery = vi.fn(async (sql: string, params: unknown[]) => createQueryResult([{
      model_defaults_json: sql.includes("UPDATE workspace_settings") ? JSON.parse(params[1] as string) : previous,
      memory_enabled: false, run_as_root: false
    }]));
    vi.mocked(withTransaction).mockImplementation(async (fn) => fn({ query: transactionQuery } as never));
    await registerWorkspaceCoreRoutes(app);
    const response = await app.inject({ method: "PATCH", url: "/api/workspaces/11111111-1111-4111-8111-111111111111/settings", payload: patch });
    expect(response.statusCode).toBe(200);
    expect(response.json().codeModeEnabled).toBe(enabled);
    const saved = JSON.parse(transactionQuery.mock.calls.find(([sql]) => sql.includes("UPDATE workspace_settings"))![1][1] as string);
    expect(saved.codeModeEnabled).toBe(stored);
    await app.close();
  });

  it("restricts the organization experiment to workspace owners", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => { request.user = { id: "user", email: "user@example.com" }; });
    mockedQuery.mockResolvedValue(createQueryResult([{ role: "member" }]));
    await registerWorkspaceCoreRoutes(app);
    const response = await app.inject({ method: "PATCH", url: "/api/workspaces/11111111-1111-4111-8111-111111111111/settings", payload: { newMessageOrganizationEnabled: false } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("returns workspace bootstrap data with optional active project", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "326522d1-67cc-4475-92ce-a85b18556261", email: "user@example.com" };
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) {
        return createQueryResult([{
          id: "326522d1-67cc-4475-92ce-a85b18556261",
          email: "user@example.com",
          display_name: "User",
          is_super_admin: false,
          byo_enabled: false,
          onboarding_completed_at: null,
          theme_preference: "system",
          task_page_preferences_json: {
            assistantMessageDisplay: { showThoughts: false },
            ui: { sendWithShiftEnter: true }
          }
        }]);
      }

      if (sql.includes("UPDATE workspace_members") && sql.includes("last_opened_at")) {
        return createQueryResult([]);
      }

      if (sql.includes("FROM workspace_members wm") && sql.includes("JOIN workspaces w")) {
        return createQueryResult([{
          id: "11111111-1111-4111-8111-111111111111",
          name: "Workspace",
          icon_key: "database",
          role: "owner"
        }]);
      }

      if (sql.includes("FROM environments e") && sql.includes("ORDER BY updated_at DESC")) {
        return createQueryResult([
          {
            id: "22222222-2222-4222-8222-222222222222",
            workspace_id: "11111111-1111-4111-8111-111111111111",
            name: "Active project",
            status: "active",
            root_path: "/runtime/project",
            json_payload: {},
            created_at: "2026-04-25T00:00:00.000Z",
            updated_at: "2026-04-25T00:00:00.000Z"
          }
        ]);
      }

      if (sql.includes("FROM workspace_settings")) {
        return createQueryResult([{
          model_defaults_json: {},
          memory_enabled: true,
          run_as_root: false
        }]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await registerWorkspaceCoreRoutes(app);

    const response = await app.inject({
      method: "GET",
      url:
        "/api/workspaces/11111111-1111-4111-8111-111111111111/bootstrap?projectId=22222222-2222-4222-8222-222222222222"
    });

    expect(response.statusCode).toBe(200);
    expect(mockedAssertWorkspaceMember).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "326522d1-67cc-4475-92ce-a85b18556261"
    );
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET last_opened_at = now()"),
      ["11111111-1111-4111-8111-111111111111", "326522d1-67cc-4475-92ce-a85b18556261"]
    );
    expect(response.json()).toMatchObject({
      user: {
        id: "326522d1-67cc-4475-92ce-a85b18556261",
        task_page_preferences: {
          assistantMessageDisplay: { showThoughts: false },
          ui: { sendWithShiftEnter: true }
        }
      },
      workspaces: [{ id: "11111111-1111-4111-8111-111111111111", name: "Workspace", iconKey: "database", role: "owner" }],
      projects: [{ id: "22222222-2222-4222-8222-222222222222", name: "Active project" }],
      workspaceSettings: { memoryEnabled: true },
      activeProject: { id: "22222222-2222-4222-8222-222222222222", name: "Active project" }
    });

    await app.close();
  });

  it("rejects bootstrap requests for non-members", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "326522d1-67cc-4475-92ce-a85b18556261", email: "user@example.com" };
    });
    mockedAssertWorkspaceMember.mockRejectedValueOnce(new Error("not a member"));

    await registerWorkspaceCoreRoutes(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/workspaces/11111111-1111-4111-8111-111111111111/bootstrap"
    });

    expect(response.statusCode).toBe(500);
    expect(mockedQuery).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns project counts in the workspace list contract", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "326522d1-67cc-4475-92ce-a85b18556261", email: "user@example.com" };
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM workspace_members wm") && sql.includes("environment_count")) {
        return createQueryResult([{
          id: "11111111-1111-4111-8111-111111111111",
          name: "Workspace",
          icon_key: "rocket",
          role: "owner",
          joined_at: "2026-04-25T00:00:00.000Z",
          created_at: "2026-04-25T00:00:00.000Z",
          updated_at: "2026-04-26T00:00:00.000Z",
          owner_id: "326522d1-67cc-4475-92ce-a85b18556261",
          owner_email: "user@example.com",
          owner_display_name: "User",
          member_count: 2,
          environment_count: 3,
          pending_invite_count: 1
        }]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await registerWorkspaceCoreRoutes(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/workspaces"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          iconKey: "rocket",
          projectCount: 3,
          environmentCount: 3,
          memberCount: 2,
          pendingInviteCount: 1
        }
      ]
    });

    await app.close();
  });

  it("updates workspace name and icon for owners", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request: Fastify.FastifyRequest) => {
      request.user = { id: "326522d1-67cc-4475-92ce-a85b18556261", email: "user@example.com" };
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT role") && sql.includes("FROM workspace_members")) {
        return createQueryResult([{ role: "owner" }]);
      }
      if (sql.includes("UPDATE workspaces")) {
        return createQueryResult([]);
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await registerWorkspaceCoreRoutes(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/workspaces/11111111-1111-4111-8111-111111111111",
      payload: {
        name: "Client Ops",
        iconKey: "briefcase-business"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("icon_key = $2"),
      ["Client Ops", "briefcase-business", "11111111-1111-4111-8111-111111111111"]
    );

    await app.close();
  });
});

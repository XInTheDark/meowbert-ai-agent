import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/runtime/persistent-shell-sessions.js", () => ({
  listPersistentShellSessions: vi.fn(),
  terminatePersistentShellSessions: vi.fn()
}));

vi.mock("../../services/workspaces/workspace-access.js", () => ({
  assertTaskMember: vi.fn(async () => ({ workspaceId: "workspace-1", environmentId: "project-1" }))
}));

vi.mock("../../services/environments/environment-for-user.js", () => ({
  getEnvironmentForUser: vi.fn(async () => ({ id: "project-1" }))
}));

vi.mock("./shared.js", async () => {
  const zod = await import("zod");
  return {
    environmentParams: zod.z.object({ envId: zod.z.string().uuid() })
  };
});

vi.mock("../tasks/shared.js", async () => {
  const zod = await import("zod");
  return {
    taskParams: zod.z.object({ taskId: zod.z.string().uuid() })
  };
});

import {
  listPersistentShellSessions,
  terminatePersistentShellSessions
} from "../../services/runtime/persistent-shell-sessions.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { registerEnvironmentPersistentShellRoutes } from "./persistent-shell-routes.js";

describe("persistent shell routes", () => {
  const mockedListPersistentShellSessions = vi.mocked(listPersistentShellSessions);
  const mockedTerminatePersistentShellSessions = vi.mocked(terminatePersistentShellSessions);
  const mockedAssertTaskMember = vi.mocked(assertTaskMember);

  beforeEach(() => {
    mockedListPersistentShellSessions.mockReset();
    mockedTerminatePersistentShellSessions.mockReset();
    mockedAssertTaskMember.mockClear();
  });

  it("lists every shell created by an authenticated task member", async () => {
    const taskId = "11111111-1111-4111-8111-111111111111";
    const items = [{
      id: "22222222-2222-4222-8222-222222222222",
      status: "completed" as const,
      command: "npm run dev",
      workingDir: "/workspace",
      startedAt: "2026-09-03T10:00:00.000Z",
      updatedAt: "2026-09-03T10:05:00.000Z",
      output: "server stopped"
    }];
    mockedListPersistentShellSessions.mockResolvedValueOnce(items);
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });
    await registerEnvironmentPersistentShellRoutes(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}/persistent-shell-sessions?includeOutput=true&outputTailLines=50`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items });
    expect(mockedAssertTaskMember).toHaveBeenCalledWith(taskId, "user-1");
    expect(mockedListPersistentShellSessions).toHaveBeenCalledWith({
      taskId,
      includeOutput: true,
      outputTailLines: 50
    });
  });

  it("terminates all active shells for an authenticated project member", async () => {
    const projectId = "33333333-3333-4333-8333-333333333333";
    mockedTerminatePersistentShellSessions.mockResolvedValueOnce(2);
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });
    await registerEnvironmentPersistentShellRoutes(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/persistent-shell-sessions/terminate-all`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ terminated: 2 });
    expect(mockedTerminatePersistentShellSessions).toHaveBeenCalledWith({ environmentId: projectId });
  });
});

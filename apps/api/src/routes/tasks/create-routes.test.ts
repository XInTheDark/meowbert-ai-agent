import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  assertEnvironmentMember: vi.fn(),
  ensureEnvironmentStorageRoot: vi.fn(),
  getPromptEntitlementStatus: vi.fn(),
  recordPromptUsageIfRequired: vi.fn(),
  requireVisiblePlatformAgentSelectionForUser: vi.fn(),
  getVisiblePlatformAgentsForUser: vi.fn(),
  createAgentSwarmTask: vi.fn(),
  createLongHorizonWorkflowTask: vi.fn(),
  createTaskWithInitialMessage: vi.fn()
}));

vi.mock("../../lib/db.js", () => ({ query: mocks.query }));
vi.mock("../../services/workspaces/workspace-access.js", () => ({ assertEnvironmentMember: mocks.assertEnvironmentMember }));
vi.mock("../../services/environments/environment-storage.js", () => ({ ensureEnvironmentStorageRoot: mocks.ensureEnvironmentStorageRoot }));
vi.mock("../../services/billing/entitlements.js", () => ({
  getPromptEntitlementStatus: mocks.getPromptEntitlementStatus,
  recordPromptUsageIfRequired: mocks.recordPromptUsageIfRequired
}));
vi.mock("../../services/platform/platform-agents.js", () => ({
  requireVisiblePlatformAgentSelectionForUser: mocks.requireVisiblePlatformAgentSelectionForUser,
  getVisiblePlatformAgentsForUser: mocks.getVisiblePlatformAgentsForUser
}));
vi.mock("../../services/tasks/task-workflows.js", () => ({
  createLongHorizonWorkflowTask: mocks.createLongHorizonWorkflowTask
}));
vi.mock("../../services/agent-swarm/creation.js", () => ({ createAgentSwarmTask: mocks.createAgentSwarmTask }));
vi.mock("../../services/tasks/task-service/index.js", () => ({ createTaskWithInitialMessage: mocks.createTaskWithInitialMessage }));

import { registerTaskCreateRoutes } from "./create-routes.js";

describe("create task with an Agent Swarm preset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ id: "11111111-1111-4111-8111-111111111111", workspace_id: "workspace-1", root_path: "/tmp/project" }] });
    mocks.assertEnvironmentMember.mockResolvedValue({ workspaceId: "workspace-1" });
    mocks.getPromptEntitlementStatus.mockResolvedValue({ allowed: true, mode: "free" });
    mocks.requireVisiblePlatformAgentSelectionForUser.mockResolvedValue({ id: "solo-swarm" });
    mocks.getVisiblePlatformAgentsForUser.mockResolvedValue({
      defaultAgentId: "luna-xhigh",
      presets: [
        { id: "luna-xhigh", name: "Luna", description: "Luna", requiresSuperAdmin: false, payload: {} },
        { id: "research", name: "Research", description: "Swarm", requiresSuperAdmin: false, payload: {},
          mode: "agent_swarm", leaderAgentId: "luna-xhigh", routerId: null, budgetsEnabled: false, tokenBudget: 20_000_000,
          advanced: { maxDepth: 1, maxLanesPerParent: 4 } }
      ]
    });
    mocks.createAgentSwarmTask.mockResolvedValue({
      taskId: "task-1", runId: "run-1", userMessageId: "message-1", reusedExisting: false
    });
  });

  async function postTask(payload: Record<string, unknown>) {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });
    await app.register(registerTaskCreateRoutes);
    const response = await app.inject({
      method: "POST", url: "/api/projects/11111111-1111-4111-8111-111111111111/tasks", payload
    });
    await app.close();
    return response;
  }

  it("starts a swarm with the composer's overrides on top of the preset's defaults", async () => {
    mocks.requireVisiblePlatformAgentSelectionForUser.mockResolvedValue({ id: "research" });

    const response = await postTask({
      message: "Research this", agent: { id: "research" },
      workflow: { type: "agent_swarm", budgetsEnabled: true, advanced: { maxLanesPerParent: 40 } }
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(mocks.createAgentSwarmTask).toHaveBeenCalledWith(expect.objectContaining({
      message: "Research this",
      settings: expect.objectContaining({
        leaderAgentId: "luna-xhigh",
        budgetsEnabled: true,
        tokenBudget: 20_000_000,
        advanced: expect.objectContaining({ maxDepth: 1, maxLanesPerParent: 16 })
      })
    }));
  });

  it("rejects a swarm whose leader the user cannot run", async () => {
    mocks.requireVisiblePlatformAgentSelectionForUser.mockResolvedValue({ id: "research" });
    mocks.getVisiblePlatformAgentsForUser.mockResolvedValue({
      defaultAgentId: "research",
      presets: [{ id: "research", name: "Research", description: "Swarm", requiresSuperAdmin: false, payload: {},
        mode: "agent_swarm", leaderAgentId: "restricted" }]
    });

    const response = await postTask({ message: "Research this", agent: { id: "research" } });

    expect(response.statusCode).toBe(400);
    expect(mocks.createAgentSwarmTask).not.toHaveBeenCalled();
  });
});

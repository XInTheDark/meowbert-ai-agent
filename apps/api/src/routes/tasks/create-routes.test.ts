import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  assertEnvironmentMember: vi.fn(),
  ensureEnvironmentStorageRoot: vi.fn(),
  getPromptEntitlementStatus: vi.fn(),
  recordPromptUsageIfRequired: vi.fn(),
  requireVisiblePlatformAgentSelectionForUser: vi.fn(),
  requireVisiblePlatformAgentAllocationsForUser: vi.fn(),
  getVisiblePlatformAgentsForUser: vi.fn(),
  createAgentSwarmWorkflowTask: vi.fn(),
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
  requireVisiblePlatformAgentAllocationsForUser: mocks.requireVisiblePlatformAgentAllocationsForUser,
  getVisiblePlatformAgentsForUser: mocks.getVisiblePlatformAgentsForUser
}));
vi.mock("../../services/tasks/task-workflows.js", () => ({
  createAgentSwarmWorkflowTask: mocks.createAgentSwarmWorkflowTask,
  createLongHorizonWorkflowTask: mocks.createLongHorizonWorkflowTask
}));
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
        { id: "solo-swarm", name: "Solo Swarm", description: "Leader only", requiresSuperAdmin: false,
          payload: {}, mode: "agent_swarm", leaderAgentId: "luna-xhigh", modelAllocations: [], reviewRounds: 0 }
      ]
    });
    mocks.createAgentSwarmWorkflowTask.mockResolvedValue({
      taskId: "task-1", runId: "run-1", userMessageId: "message-1", reusedExisting: false
    });
  });

  it("uses the preset's empty roster even when the composer sends a worker count", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });
    await app.register(registerTaskCreateRoutes);

    const response = await app.inject({ method: "POST", url: "/api/projects/11111111-1111-4111-8111-111111111111/tasks", payload: {
      message: "Research this", agent: { id: "solo-swarm" },
      workflow: { type: "agent_swarm", workerCount: 2, leaderAgentId: "luna-xhigh",
        modelAllocations: [{ agentId: "luna-xhigh", workerCount: 2 }], tokenBudget: 80_000 }
    } });

    expect(response.statusCode, response.body).toBe(201);
    expect(mocks.createAgentSwarmWorkflowTask).toHaveBeenCalledWith(expect.objectContaining({
      workerCount: 0,
      agentAllocations: [],
      leaderAgentId: "luna-xhigh",
      tokenBudget: 80_000,
      compiledSwarm: expect.objectContaining({
        nodes: [expect.objectContaining({ workerLeafIds: [] })],
        leaves: [expect.objectContaining({ agentId: "luna-xhigh" })]
      })
    }));
    expect(mocks.requireVisiblePlatformAgentAllocationsForUser).not.toHaveBeenCalled();
    await app.close();
  });

  it("keeps explicit allocations for a custom Swarm with a regular agent selected", async () => {
    mocks.requireVisiblePlatformAgentSelectionForUser.mockResolvedValue({ id: "luna-xhigh" });
    mocks.requireVisiblePlatformAgentAllocationsForUser.mockResolvedValue([{ agentId: "luna-xhigh", workerCount: 2 }]);
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });
    await app.register(registerTaskCreateRoutes);

    const response = await app.inject({ method: "POST", url: "/api/projects/11111111-1111-4111-8111-111111111111/tasks", payload: {
      message: "Research this", agent: { id: "luna-xhigh" },
      workflow: { type: "agent_swarm", workerCount: 2, leaderAgentId: "luna-xhigh",
        modelAllocations: [{ agentId: "luna-xhigh", workerCount: 2 }] }
    } });

    expect(response.statusCode, response.body).toBe(201);
    expect(mocks.createAgentSwarmWorkflowTask).toHaveBeenCalledWith(expect.objectContaining({
      workerCount: 2,
      agentAllocations: [{ agentId: "luna-xhigh", workerCount: 2 }]
    }));
    await app.close();
  });
});

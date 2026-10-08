import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const platformAgentsMock = vi.hoisted(() => ({
  getVisiblePlatformAgentsForUser: vi.fn()
}));

const workspaceMock = vi.hoisted(() => ({
  assertWorkspaceMember: vi.fn(),
  loadWorkspaceDefaultAgentId: vi.fn()
}));

vi.mock("../services/platform/platform-agents.js", () => platformAgentsMock);
vi.mock("../services/workspaces/workspace-access.js", () => ({ assertWorkspaceMember: workspaceMock.assertWorkspaceMember }));
vi.mock("../services/workspaces/workspace-default-agent.js", () => ({
  loadWorkspaceDefaultAgentId: workspaceMock.loadWorkspaceDefaultAgentId
}));

import { agentRoutes } from "./agents.js";

describe("agentRoutes", () => {
  beforeEach(() => {
    platformAgentsMock.getVisiblePlatformAgentsForUser.mockReset();
  });

  it("omits hidden presets from the model picker and resolves a visible default", async () => {
    platformAgentsMock.getVisiblePlatformAgentsForUser.mockResolvedValue({
      actorIsSuperAdmin: false,
      modelSliderAgentIds: [],
      presets: [
        {
          id: "default",
          name: "Default",
          description: "Hidden default",
          hidden: true,
          requiresSuperAdmin: false,
          payload: {}
        },
        {
          id: "visible",
          name: "Visible",
          description: "Visible preset",
          requiresSuperAdmin: false,
          payload: {}
        },
        {
          id: "internal",
          name: "Internal",
          description: "Internal preset",
          hidden: true,
          requiresSuperAdmin: false,
          payload: {}
        }
      ],
      defaultAgentId: "default"
    });

    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });
    await app.register(agentRoutes);

    const response = await app.inject({ method: "GET", url: "/api/agents" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      agents: [{ id: "visible", name: "Visible", description: "Visible preset", mode: "standard" }],
      defaultAgentId: "visible",
      platformDefaultAgentId: "visible"
    });

    await app.close();
  });

  it("returns the model slider configuration only for super admins", async () => {
    platformAgentsMock.getVisiblePlatformAgentsForUser.mockResolvedValue({
      actorIsSuperAdmin: true,
      modelSliderAgentIds: ["deep", "default"],
      presets: [
        {
          id: "default",
          name: "Default",
          description: "Default preset",
          requiresSuperAdmin: false,
          payload: {}
        },
        {
          id: "deep",
          name: "Deep",
          description: "Deep preset",
          requiresSuperAdmin: true,
          payload: {}
        }
      ],
      defaultAgentId: "default"
    });

    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.user = { id: "admin-1", email: "admin@example.com" };
    });
    await app.register(agentRoutes);

    const response = await app.inject({ method: "GET", url: "/api/agents" });

    expect(response.json()).toEqual({
      agents: [
        { id: "default", name: "Default", description: "Default preset", mode: "standard" },
        { id: "deep", name: "Deep", description: "Deep preset", mode: "standard" }
      ],
      defaultAgentId: "default",
      platformDefaultAgentId: "default",
      modelSliderAgentIds: ["deep", "default"]
    });

    await app.close();
  });

  it("reports the compiled worker count for a leader-only Swarm preset", async () => {
    platformAgentsMock.getVisiblePlatformAgentsForUser.mockResolvedValue({
      actorIsSuperAdmin: false,
      modelSliderAgentIds: [],
      presets: [
        { id: "luna-xhigh", name: "Luna", description: "Luna", requiresSuperAdmin: false, payload: {} },
        { id: "solo-swarm", name: "Solo Swarm", description: "Leader only", requiresSuperAdmin: false,
          payload: {}, mode: "agent_swarm", leaderAgentId: "luna-xhigh", modelAllocations: [], reviewRounds: 0 }
      ],
      defaultAgentId: "luna-xhigh"
    });

    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });
    await app.register(agentRoutes);

    const response = await app.inject({ method: "GET", url: "/api/agents" });

    expect(response.json().agents).toContainEqual({
      id: "solo-swarm", name: "Solo Swarm", description: "Leader only", mode: "agent_swarm",
      swarmWorkerCount: 0, swarmReviewRounds: 0,
      swarm: {
        leaderAgentId: "luna-xhigh",
        modelAllocations: [],
        reviewRounds: 0,
        tokenBudget: 10_000_000,
        timeBudgetMinutes: null,
        disableSpawningAndBudgets: false,
        members: [{ id: "luna-xhigh", name: "Luna", mode: "standard" }]
      }
    });
    await app.close();
  });

  it("defaults to the workspace's default agent for workspace members", async () => {
    platformAgentsMock.getVisiblePlatformAgentsForUser.mockResolvedValue({
      actorIsSuperAdmin: false,
      modelSliderAgentIds: [],
      presets: [
        { id: "default", name: "Default", description: "Default", requiresSuperAdmin: false, payload: {} },
        { id: "fast", name: "Fast", description: "Fast", requiresSuperAdmin: false, payload: {} }
      ],
      defaultAgentId: "default"
    });
    workspaceMock.loadWorkspaceDefaultAgentId.mockResolvedValue("fast");

    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.user = { id: "user-1", email: "user@example.com" };
    });
    await app.register(agentRoutes);

    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const response = await app.inject({ method: "GET", url: `/api/agents?workspaceId=${workspaceId}` });

    expect(workspaceMock.assertWorkspaceMember).toHaveBeenCalledWith(workspaceId, "user-1");
    expect(response.json()).toMatchObject({ defaultAgentId: "fast", platformDefaultAgentId: "default" });
    await app.close();
  });
});

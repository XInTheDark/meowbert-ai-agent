import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../platform/platform-agents.js", () => ({
  getVisiblePlatformAgentsForUser: vi.fn(async () => ({ presets: [], defaultAgentId: null })),
  requireVisiblePlatformAgentSelectionForUser: vi.fn(async (_userId: string, agent: { id: string } | null) => agent ?? undefined)
}));
vi.mock("../workspaces/workspace-default-agent.js", () => ({ loadWorkspaceDefaultAgentId: vi.fn(async () => null) }));
vi.mock("../tasks/task-service/swarm-selection.js", () => ({
  resolveSelectedSwarm: vi.fn(async (_userId: string, agentId?: string) => agentId === "swarm"
    ? { preset: { id: "swarm", mode: "agent_swarm" }, compiled: { nodes: [], leaves: [], rootNodeId: "root" }, dynamicNodeTypes: [] }
    : null)
}));
vi.mock("../tasks/agent-swarm-task-creation.js", () => ({
  createAgentSwarmTaskFromSettings: vi.fn(async (base: { taskId: string }) => ({ taskId: base.taskId, reusedExisting: false }))
}));
vi.mock("../tasks/task-service/index.js", () => ({
  createTaskWithInitialMessage: vi.fn(async (input: { taskId: string }) => ({ taskId: input.taskId, reusedExisting: false })),
  appendTaskUserMessageAndEnqueue: vi.fn(async () => ({ mode: "enqueued" }))
}));
vi.mock("../tasks/task-history.js", () => ({ ensureTaskHistoryWarm: vi.fn() }));
vi.mock("../tasks/task-cancellation.js", () => ({ cancelTaskAndSchedules: vi.fn() }));

import { query } from "../../lib/db.js";
import { createAgentSwarmTaskFromSettings } from "../tasks/agent-swarm-task-creation.js";
import { appendTaskUserMessageAndEnqueue, createTaskWithInitialMessage } from "../tasks/task-service/index.js";
import { createManagedTask, messageManagedTask } from "./managed-tasks.js";

const master = { taskId: "11111111-1111-4111-8111-111111111111", environmentId: "env", workspaceId: "ws" };
const route = { routerId: "router-v1", modelId: "deep", reasoningScore: 62 };

describe("tasks the Project Master manages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(query).mockResolvedValue({ rows: [{ default_timezone: "UTC", id: "task" }], rowCount: 1 } as never);
  });

  it("starts an Agent Swarm when the Master's tasks are set to a swarm", async () => {
    await createManagedTask({ master, userId: "u", taskId: "t1", title: null, message: "Go", agent: { id: "swarm" }, modelRoute: null });

    expect(createAgentSwarmTaskFromSettings).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t1", agent: { id: "swarm" }, sender: "project_master" }),
      expect.anything()
    );
    expect(createTaskWithInitialMessage).not.toHaveBeenCalled();
  });

  it("starts a plain task on the picked agent with the Master's router pick", async () => {
    await createManagedTask({ master, userId: "u", taskId: "t2", title: null, message: "Go", agent: { id: "router" }, modelRoute: route });

    expect(createTaskWithInitialMessage).toHaveBeenCalledWith(expect.objectContaining({ agent: { id: "router" }, modelRoute: route }));
  });

  it("keeps a task on its model when the Master follows up", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: "task" }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ content_json: { text: "Go", agent: { id: "router" }, modelRoute: route } }], rowCount: 1 } as never);

    await messageManagedTask({ master, userId: "u", taskId: "22222222-2222-4222-8222-222222222222", message: "More" });

    expect(appendTaskUserMessageAndEnqueue).toHaveBeenCalledWith(expect.objectContaining({ agent: { id: "router" }, modelRoute: route }));
  });
});

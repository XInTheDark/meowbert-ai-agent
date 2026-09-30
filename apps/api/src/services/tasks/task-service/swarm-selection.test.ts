import { describe, expect, it, vi } from "vitest";
import type { PlatformAgentPreset } from "@meowbert/shared";

const mocks = vi.hoisted(() => ({
  getVisiblePlatformAgentsForUser: vi.fn(),
  assertTaskTypeTransitionIdleInTx: vi.fn(),
  applyWorkflowTransitionInTx: vi.fn()
}));

vi.mock("../../platform/platform-agents.js", () => ({
  getVisiblePlatformAgentsForUser: mocks.getVisiblePlatformAgentsForUser
}));
vi.mock("../task-workflow-transitions.js", () => ({
  assertTaskTypeTransitionIdleInTx: mocks.assertTaskTypeTransitionIdleInTx,
  applyWorkflowTransitionInTx: mocks.applyWorkflowTransitionInTx
}));

import { applySelectedSwarmInTx, resolveSelectedSwarm } from "./swarm-selection.js";

const presets: PlatformAgentPreset[] = [
  { id: "luna-xhigh", name: "Luna", description: "", requiresSuperAdmin: true, payload: { model: "gpt-6-luna" }, spawnableAsNode: true },
  { id: "quality-mini", name: "Quality", description: "", requiresSuperAdmin: false, payload: { model: "gpt-6-luna" }, mode: "quality_control_reviewer", spawnableAsNode: true },
  {
    id: "luna-x6-quality", name: "Luna x6", description: "", requiresSuperAdmin: true, payload: {},
    mode: "agent_swarm", leaderAgentId: "luna-xhigh",
    modelAllocations: [
      { agentId: "luna-xhigh", workerCount: 4 },
      { agentId: "quality-mini", workerCount: 1 }
    ], reviewRounds: 1
  }
];

describe("selected swarm on an existing task", () => {
  it("compiles leaf assignments and changes an idle standard task before its next run", async () => {
    vi.clearAllMocks();
    mocks.getVisiblePlatformAgentsForUser.mockResolvedValue({ presets, defaultAgentId: "luna-xhigh" });
    const selectedSwarm = await resolveSelectedSwarm("user-1", "luna-x6-quality");
    expect(selectedSwarm?.compiled.leaves.map((leaf) => leaf.agentId)).toEqual([
      "luna-xhigh", "luna-xhigh", "luna-xhigh", "luna-xhigh", "luna-xhigh", "quality-mini"
    ]);

    const task = {
      id: "task-1", workspace_id: "workspace-1", environment_id: "environment-1",
      default_timezone: "UTC", allow_waiting: true, workflow_type: null, title: "Task"
    };
    const query = vi.fn().mockResolvedValueOnce({ rows: [task] }).mockResolvedValue({ rows: [] });
    await applySelectedSwarmInTx({ query } as never, {
      taskId: "task-1", userId: "user-1", selectedSwarm: selectedSwarm!, prompt: "Use the swarm"
    });

    expect(mocks.assertTaskTypeTransitionIdleInTx).toHaveBeenCalledWith(expect.anything(), "task-1");
    expect(mocks.applyWorkflowTransitionInTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      task,
      promptOverride: "Use the swarm",
      workflow: expect.objectContaining({ type: "agent_swarm", workerCount: 5 }),
      compiledSwarm: selectedSwarm?.compiled,
      dynamicNodeTypes: [
        expect.objectContaining({ id: "luna-xhigh" }),
        expect.objectContaining({ id: "quality-mini", mode: "quality_control_reviewer" })
      ]
    }));
    expect(query).toHaveBeenCalledWith("DELETE FROM task_schedules WHERE task_id = $1", ["task-1"]);
  });
});

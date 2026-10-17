import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn() }));
vi.mock("./shared.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./shared.js")>(),
  enqueueWorkflowTaskRun: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import { enqueueWorkflowTaskRun } from "./shared.js";
import { wakeParentForSwarmQuota } from "./agent-swarm-budget-notices.js";

const worker = {
  id: "worker-agent", role: "worker" as const, slot_index: 1, task_id: "worker-task", title: "Worker", status: "running",
  task_root_path: "/tmp/task", last_inbox_refresh_message_no: 0, state_json: {}
};
const context = {
  workflowTaskId: "workflow-1",
  workflowType: "agent_swarm",
  phase: "active",
  config: { tokenBudget: 1_000_000 },
  taskId: "worker-task",
  taskDir: "/tmp/task",
  workspaceId: "workspace-1",
  environmentId: "environment-1",
  currentAgent: worker,
  agents: [worker],
  planContent: null
} satisfies LoadedWorkflowRunContext;

describe("Agent Swarm budget notices", () => {
  const mockedQuery = vi.mocked(query);
  const client = { query: vi.fn() };
  let leaderPauseRows: Array<Record<string, unknown>> = [];

  const setup = (member: { role: "leader" | "worker"; parentLeaderTaskId: string | null }) => {
    mockedQuery.mockResolvedValueOnce({ rows: [{
      node_id: "node-1", workflow_agent_id: "agent-1", role: member.role,
      node_leader_task_id: "leader-task", parent_leader_task_id: member.parentLeaderTaskId
    }], rowCount: 1 } as never);
  };
  const postedNotice = () => client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO task_workflow_messages"));

  beforeEach(() => {
    vi.clearAllMocks();
    leaderPauseRows = [{
      task_id: "leader-task", swarm_node_id: null, since_message_no: 3, status: "Waiting.", waiting_for_task_ids: [],
      finished_task_ids: [], trigger_source: "web", selection_user_id: "user-1", mode: "agent_swarm_leader"
    }];
    vi.mocked(withTransaction).mockImplementation(async (callback) => callback(client as never));
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT phase, config_json")) {
        return { rows: [{ phase: "active", config_json: { swarmChannelIds: { "root-key": "global-channel", "node-key": "node-channel" } } }] };
      }
      if (sql.includes("parent_node.node_key")) return { rows: [{ node_key: "node-key", title: "Research", parent_node_key: "root-key" }] };
      if (sql.includes("SELECT phase FROM task_workflows")) return { rows: [{ phase: "active" }] };
      if (sql.includes("DELETE FROM task_workflow_swarm_pauses")) return { rows: leaderPauseRows };
      return { rows: [] };
    });
  });

  it("tells a worker's leader, as the system, to deliver once the shared pool is spent", async () => {
    setup({ role: "worker", parentLeaderTaskId: null });

    await wakeParentForSwarmQuota({ context, reason: "worker_budget_exhausted", detail: "Spent." });

    const [, params] = postedNotice() ?? [];
    expect(params?.slice(0, 2)).toEqual(["workflow-1", "node-channel"]);
    expect(String(postedNotice()?.[0])).toContain("VALUES ($1, $2, NULL, $3)");
    expect(params?.[2]).toContain("final_response");
    expect(vi.mocked(enqueueWorkflowTaskRun)).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "leader-task", mode: "agent_swarm_leader"
    }));
  });

  it("asks a nested node's leader to publish its result instead", async () => {
    setup({ role: "worker", parentLeaderTaskId: "root-task" });

    await wakeParentForSwarmQuota({ context, reason: "worker_budget_exhausted", detail: "Spent." });

    expect(postedNotice()?.[1][2]).toContain("submit_swarm_output");
  });

  it("reports a spent child node in the parent's channel without touching the parent's history", async () => {
    setup({ role: "leader", parentLeaderTaskId: "root-task" });
    leaderPauseRows = [];

    await wakeParentForSwarmQuota({ context, reason: "budget_exhausted", detail: "Spent." });

    expect(postedNotice()?.[1].slice(0, 2)).toEqual(["workflow-1", "global-channel"]);
    expect(postedNotice()?.[1][2]).toContain("swarm_grant_budget");
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO task_messages"))).toBe(false);
    // The parent is still running, so it reads the notice on its next inbox refresh instead of a second run.
    expect(vi.mocked(enqueueWorkflowTaskRun)).not.toHaveBeenCalled();
  });

  it("has no one to notify when the root leader stops", async () => {
    setup({ role: "leader", parentLeaderTaskId: null });

    await wakeParentForSwarmQuota({ context, reason: "budget_exhausted", detail: "Spent." });

    expect(postedNotice()).toBeUndefined();
  });
});

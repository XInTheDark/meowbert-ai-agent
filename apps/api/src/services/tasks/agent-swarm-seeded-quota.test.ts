import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { CompiledAgentSwarm } from "@meowbert/shared";
import { insertSeededSwarmQuotaNodesInTx } from "./agent-swarm-seeded-quota.js";

const compiledSwarm: CompiledAgentSwarm = {
  rootNodeId: "root",
  nodes: [
    { id: "root", parentNodeId: null, title: "Root", leaderLeafId: "leader", workerLeafIds: ["child-leader"], reviewRounds: 0 },
    { id: "child", parentNodeId: "root", title: "Research", leaderLeafId: "child-leader", workerLeafIds: ["child-worker"], reviewRounds: 0 }
  ],
  leaves: [
    { id: "leader", agentId: "leader-preset", name: "Leader", mode: "standard", nodeIds: ["root"], leaderNodeIds: ["root"], parentNodeId: null },
    { id: "child-leader", agentId: "leader-preset", name: "Research leader", mode: "standard", nodeIds: ["root", "child"], leaderNodeIds: ["child"], parentNodeId: "root" },
    { id: "child-worker", agentId: "worker-preset", name: "Research worker", mode: "standard", nodeIds: ["child"], leaderNodeIds: [], parentNodeId: "child" }
  ]
};

describe("seeded Agent Swarm quotas", () => {
  it("creates nested nodes and members paused until the parent grants a budget", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "quota-child" }] });
    await insertSeededSwarmQuotaNodesInTx({ query } as unknown as PoolClient, {
      workflowTaskId: "workflow-task",
      compiledSwarm,
      rootQuotaNodeId: "quota-root",
      agentIdsByLeaf: new Map([
        ["leader", "leader-agent"],
        ["child-leader", "child-agent"],
        ["child-worker", "worker-agent"]
      ])
    });

    const nodeInsert = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO task_workflow_swarm_nodes"));
    expect(nodeInsert?.[0]).toContain("'paused', 'budget_exhausted'");
    expect(nodeInsert?.[1]).toEqual(["workflow-task", "quota-root", "child", 0, "Research", 2, "child-agent"]);
    const memberInserts = query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO task_workflow_swarm_node_members"));
    expect(memberInserts.map(([, params]) => params)).toEqual([
      ["quota-child", "child-agent", "leader", 0],
      ["quota-child", "worker-agent", "worker", 0]
    ]);
    expect(memberInserts.every(([sql]) => String(sql).includes("'paused'"))).toBe(true);
  });
});

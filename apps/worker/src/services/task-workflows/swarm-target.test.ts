import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import { channelsForSwarmTarget, resolveSwarmChannelForAgent } from "./agent-swarm-channel-access.js";
import { hasSwarmLeadership, resolveSwarmTarget } from "./swarm-target.js";
import { recordSwarmReviewRound } from "./agent-swarm-reviews.js";
import { sendSwarmChannelMessage, submitSwarmOutput } from "./agent-swarm-messaging.js";

function createContext(taskId = "inner-leader"): LoadedWorkflowRunContext {
  const agents: LoadedWorkflowRunContext["agents"] = [
    ["root-leader", "leader", "root-leaf", ["outer-node"], ["outer-node"]],
    ["inner-leader", "worker", "inner-leaf", ["inner-node", "outer-node"], ["inner-node"]],
    ["inner-worker", "worker", "worker-leaf", ["inner-node"], []]
  ].map(([id, role, leafId, nodeIds, leaderNodeIds], index) => ({
    id: `${id}-agent`,
    role: role as "leader" | "worker",
    slot_index: index,
    task_id: id as string,
    title: id as string,
    status: "running",
    task_root_path: `/tasks/${id}`,
    last_inbox_refresh_message_no: 0,
    state_json: {
      swarmLeafId: leafId,
      swarmNodeIds: nodeIds,
      swarmLeaderNodeIds: leaderNodeIds,
      swarmParentNodeId: id === "inner-leader" ? "inner-node" : nodeIds[0]
    }
  }));
  return {
    workflowTaskId: "root-leader", workflowType: "agent_swarm", phase: "active",
    config: {
      compiledSwarm: {
        rootNodeId: "outer-node",
        nodes: [
          { id: "outer-node", parentNodeId: null, leaderLeafId: "root-leaf", workerLeafIds: ["inner-leaf"] },
          { id: "inner-node", parentNodeId: "outer-node", leaderLeafId: "inner-leaf", workerLeafIds: ["worker-leaf"] }
        ]
      },
      swarmChannelIds: { "outer-node": "outer-channel", "inner-node": "inner-channel" }
    },
    taskId, taskDir: `/tasks/${taskId}`, workspaceId: "workspace", environmentId: "environment",
    currentAgent: agents.find((agent) => agent.task_id === taskId)!, agents, planContent: null
  };
}

describe("swarm target", () => {
  it("maps a nested leader to its outer member and inner leader roles", () => {
    const context = createContext();
    expect(hasSwarmLeadership(context)).toBe(true);
    expect(() => resolveSwarmTarget(context)).toThrow("target_swarm");
    expect(resolveSwarmTarget(context, "outer")).toMatchObject({
      nodeId: "outer-node", channelId: "outer-channel", isLeader: false,
      workerTaskIds: ["inner-leader"]
    });
    expect(resolveSwarmTarget(context, "inner")).toMatchObject({
      nodeId: "inner-node", channelId: "inner-channel", isLeader: true,
      workerTaskIds: ["inner-worker"]
    });
  });

  it("keeps ordinary workers on their one swarm without an outer target", () => {
    const context = createContext("inner-worker");
    expect(hasSwarmLeadership(context)).toBe(false);
    expect(resolveSwarmTarget(context).nodeId).toBe("inner-node");
    expect(() => resolveSwarmTarget(context, "outer")).toThrow("dual-role");
  });

  it("allows the same leader to manage both swarms when it leads both", () => {
    const context = createContext("root-leader");
    context.agents[0].state_json.swarmNodeIds = ["inner-node", "outer-node"];
    context.agents[0].state_json.swarmLeaderNodeIds = ["inner-node", "outer-node"];
    const nodes = (context.config.compiledSwarm as { nodes: Array<Record<string, unknown>> }).nodes;
    nodes[1].leaderLeafId = "root-leaf";
    expect(resolveSwarmTarget(context, "outer").isLeader).toBe(true);
    expect(resolveSwarmTarget(context, "inner").isLeader).toBe(true);
  });

  it("shows a dual-role leader only channels in the selected swarm", () => {
    const context = createContext();
    const channels = [
      ["outer-channel", "global", ["root-leader", "inner-leader"]],
      ["inner-channel", "group", ["inner-leader", "inner-worker"]],
      ["outer-direct", "direct", ["root-leader", "inner-leader"]],
      ["inner-direct", "direct", ["inner-leader", "inner-worker"]]
    ].map(([id, kind, members]) => ({
      id: id as string, kind: kind as "global" | "group" | "direct", title: null,
      created_at: "", latest_message_no: 0, unread_count: 0, member_task_ids: members as string[]
    }));
    expect(channelsForSwarmTarget(context, channels, "outer").map((channel) => channel.id))
      .toEqual(["outer-channel", "outer-direct"]);
    expect(channelsForSwarmTarget(context, channels, "inner").map((channel) => channel.id))
      .toEqual(["inner-channel", "inner-direct"]);
  });

  it("resolves the selected swarm's channel and rejects the other swarm's channel", async () => {
    const context = createContext();
    vi.mocked(query).mockResolvedValue({ rows: [
      {
        id: "outer-channel", kind: "global", title: "Global", created_at: "",
        latest_message_no: 0, unread_count: 0, member_task_ids: ["root-leader", "inner-leader"]
      },
      {
        id: "inner-channel", kind: "group", title: "Inner", created_at: "",
        latest_message_no: 0, unread_count: 0, member_task_ids: ["inner-leader", "inner-worker"]
      }
    ], rowCount: 2 } as never);
    expect((await resolveSwarmChannelForAgent(context, "global", "inner")).id).toBe("inner-channel");
    await expect(resolveSwarmChannelForAgent(context, "inner-channel", "outer"))
      .rejects.toThrow("not a member of that channel");
  });

  it("records an inner review without granting outer leader permissions", async () => {
    const context = createContext();
    const nodes = (context.config.compiledSwarm as { nodes: Array<Record<string, unknown>> }).nodes;
    nodes[1].reviewRounds = 1;
    const client = { query: vi.fn(async (sql: string) => sql.includes("SELECT state_json")
      ? { rows: [{ state_json: {} }] }
      : { rows: [] }) };
    vi.mocked(withTransaction).mockImplementation(async (callback) => callback(client as never));

    await expect(recordSwarmReviewRound({
      context, targetSwarm: "outer", reviewer: "inner-leader", summary: "Reviewed"
    })).rejects.toThrow("Only the Agent Swarm leader");
    await expect(recordSwarmReviewRound({
      context, targetSwarm: "inner", reviewer: "root-leader", summary: "Reviewed"
    })).rejects.toThrow("Reviewers must be existing swarm workers");
    await expect(recordSwarmReviewRound({
      context, targetSwarm: "inner", reviewer: "inner-worker", summary: "Reviewed"
    })).resolves.toMatchObject({ completedRounds: 1, requiredRounds: 1 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE task_workflows"),
      ["root-leader", expect.stringContaining('"reviewRoundsByNode":{"inner-node":')]
    );
  });

  it("accepts inner swarm output only from its leader with the inner target", async () => {
    const context = createContext();
    await expect(submitSwarmOutput(context, "Done", "outer"))
      .rejects.toThrow("nested swarm leader");
    await expect(submitSwarmOutput(createContext("inner-worker"), "Done"))
      .rejects.toThrow("nested swarm leader");
  });

  it("waits for a started child swarm before publishing its parent's output", async () => {
    const context = createContext();
    const nodes = (context.config.compiledSwarm as { nodes: Array<Record<string, unknown>> }).nodes;
    nodes.push({
      id: "child-node", parentNodeId: "inner-node", leaderLeafId: "worker-leaf", workerLeafIds: []
    });
    const client = { query: vi.fn(async () => ({ rows: [{ state_json: {
      startedSwarmWorkerTaskIds: ["inner-worker"], completedSwarmNodeIds: {}
    } }] })) };
    vi.mocked(withTransaction).mockImplementation(async (callback) => callback(client as never));

    await expect(submitSwarmOutput(context, "Done", "inner"))
      .rejects.toThrow("Nested swarm child-node must publish its output first.");
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";
import { listAgentSwarmNodeTypes } from "./agent-swarm-node-types.js";

describe("Agent Swarm node types", () => {
  it("makes only explicitly enabled node types available with their specified rosters", () => {
    const types = listAgentSwarmNodeTypes([
      { id: "solo", name: "Solo researcher", description: "Investigates one topic", spawnableAsNode: true },
      { id: "reviewer", name: "Reviewer", description: "Reviews one topic", mode: "quality_control_reviewer", spawnableAsNode: true },
      { id: "ordinary", name: "Ordinary", description: "Not opted in" },
      { id: "small", name: "Small swarm", description: "Three Luna workers", mode: "agent_swarm",
        hidden: true, spawnableAsNode: true, leaderAgentId: "luna",
        modelAllocations: [{ agentId: "luna", workerCount: 3 }], reviewRounds: 1 },
      { id: "large", name: "Large swarm", description: "Mixed workers", mode: "agent_swarm",
        spawnableAsNode: true, leaderAgentId: "sol",
        modelAllocations: [{ agentId: "luna", workerCount: 4 }, { agentId: "sol", workerCount: 2 }] },
      { id: "unmarked", name: "Unmarked swarm", description: "Not opted in", mode: "agent_swarm",
        leaderAgentId: "sol", modelAllocations: [] },
      { id: "disabled", name: "Disabled swarm", description: "Unavailable to leaders", mode: "agent_swarm",
        spawnableAsNode: false, leaderAgentId: "sol", modelAllocations: [] },
      { id: "nested", name: "Nested topology", description: "Starts with another swarm", mode: "agent_swarm",
        leaderAgentId: "sol", modelAllocations: [{ agentId: "small", workerCount: 1 }] }
    ]);

    expect(types).toEqual([
      { id: "solo", name: "Solo researcher", description: "Investigates one topic", leaderAgentId: "solo",
        leaderAgentMode: "standard", modelAllocations: [], workerAgentModes: [], reviewRounds: 0 },
      { id: "reviewer", name: "Reviewer", description: "Reviews one topic", leaderAgentId: "reviewer",
        leaderAgentMode: "quality_control_reviewer", modelAllocations: [], workerAgentModes: [], reviewRounds: 0 },
      { id: "small", name: "Small swarm", description: "Three Luna workers", leaderAgentId: "luna",
        leaderAgentMode: "standard", modelAllocations: [{ agentId: "luna", workerCount: 3 }], workerAgentModes: ["standard"], reviewRounds: 1 },
      { id: "large", name: "Large swarm", description: "Mixed workers", leaderAgentId: "sol",
        leaderAgentMode: "standard", modelAllocations: [{ agentId: "luna", workerCount: 4 }, { agentId: "sol", workerCount: 2 }], workerAgentModes: ["standard", "standard"], reviewRounds: 0 }
    ]);
  });
});

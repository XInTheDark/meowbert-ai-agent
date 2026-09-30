import { describe, expect, it } from "vitest";
import type { PlatformAgentPreset } from "@meowbert/shared";
import { selectAgentSwarmNodeTypes } from "./agent-swarm-node-types.js";

function preset(id: string, mode?: "agent_swarm"): PlatformAgentPreset {
  return {
    id, name: id, description: id, requiresSuperAdmin: false, payload: {},
    ...(mode ? { mode } : {})
  };
}

describe("selectAgentSwarmNodeTypes", () => {
  it("keeps eligible flat Swarms and opted-in individual agents visible to the task owner", () => {
    const luna = preset("luna");
    const solo = { ...preset("solo"), spawnableAsNode: true, description: "Independent researcher" };
    const reviewer = { ...preset("reviewer"), mode: "quality_control_reviewer" as const, spawnableAsNode: true };
    const small = { ...preset("small", "agent_swarm"), hidden: true, spawnableAsNode: true, leaderAgentId: "luna",
      modelAllocations: [{ agentId: "luna", workerCount: 3 }] };
    const unmarked = { ...preset("unmarked", "agent_swarm"), leaderAgentId: "luna", modelAllocations: [] };
    const disabled = { ...preset("disabled", "agent_swarm"), spawnableAsNode: false,
      leaderAgentId: "luna", modelAllocations: [] };
    const unavailable = { ...preset("unavailable", "agent_swarm"), spawnableAsNode: true, leaderAgentId: "restricted",
      modelAllocations: [] };
    const nested = { ...preset("nested", "agent_swarm"), spawnableAsNode: true, leaderAgentId: "luna",
      modelAllocations: [{ agentId: "small", workerCount: 1 }] };

    expect(selectAgentSwarmNodeTypes([luna, solo, reviewer, small, unmarked, disabled, unavailable, nested]))
      .toEqual([solo, reviewer, small]);
  });
});

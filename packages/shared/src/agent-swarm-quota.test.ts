import { describe, expect, it } from "vitest";
import {
  calculateAgentSwarmBudgetEstimate,
  calculateAgentSwarmInitialLeases,
  calculateAgentSwarmLeaderAllowance,
  calculateAgentSwarmMinimumGrant,
  calculateAgentSwarmSystemReserve,
  AGENT_SWARM_MAX_ACTIVE_NODES,
  AGENT_SWARM_MAX_DEPTH
} from "./agent-swarm-quota.js";

describe("agent swarm quota contracts", () => {
  it("lets a leader spend a fifth of the operating budget, or as much as it has delegated", () => {
    expect(calculateAgentSwarmLeaderAllowance({ allocatedTokens: 10_000_000, delegatedTokens: 1_000_000 })).toBe(1_800_000);
    expect(calculateAgentSwarmLeaderAllowance({ allocatedTokens: 10_000_000, delegatedTokens: 4_000_000 })).toBe(4_000_000);
  });

  it("keeps two recovery steps or ten percent, whichever is larger", () => {
    expect(calculateAgentSwarmSystemReserve(10_000, 512)).toBe(1_024);
    expect(calculateAgentSwarmSystemReserve(1_000, 512)).toBe(1_024);
  });

  it("computes minimum and recommended allocations from the current step weight", () => {
    expect(calculateAgentSwarmBudgetEstimate({ minimumStepTokens: 1_000, workerSlots: 3 })).toEqual({
      minimumStepTokens: 1_000,
      minimumResumeGrantTokens: 1_112,
      minimumSpawnAllocationTokens: 4_445,
      recommendedSpawnAllocationTokens: 17_780
    });
  });

  it("includes the reserve when validating a grant", () => {
    expect(calculateAgentSwarmMinimumGrant({
      allocatedTokens: 20_000,
      minimumStepTokens: 1_000,
      workerSlots: 3,
      spawning: false
    })).toBe(3_112);
  });

  it("publishes the hard topology limits", () => {
    expect(AGENT_SWARM_MAX_DEPTH).toBe(8);
    expect(AGENT_SWARM_MAX_ACTIVE_NODES).toBe(256);
  });

  it("leaves at least 90% of the operating budget for the leader to delegate", () => {
    expect(calculateAgentSwarmInitialLeases({
      operatingTokens: 900_000,
      workerCount: 3,
      minimumStepTokens: 8_192
    })).toEqual({ leaderLeaseTokens: 0, workerLeaseTokens: 30_000, unassignedTokens: 810_000 });
    expect(calculateAgentSwarmInitialLeases({
      operatingTokens: 900_000,
      workerCount: 0,
      minimumStepTokens: 8_192
    })).toEqual({ leaderLeaseTokens: 0, workerLeaseTokens: 0, unassignedTokens: 900_000 });
    expect(calculateAgentSwarmInitialLeases({
      operatingTokens: 100_000,
      workerCount: 3,
      minimumStepTokens: 8_192
    })).toEqual({ leaderLeaseTokens: 0, workerLeaseTokens: 8_192, unassignedTokens: 75_424 });
  });
});

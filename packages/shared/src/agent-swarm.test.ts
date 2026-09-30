import { describe, expect, it } from "vitest";
import {
  AGENT_SWARM_MAX_WORKERS,
  AGENT_SWARM_MAX_REVIEW_ROUNDS,
  clampAgentSwarmReviewRounds,
  clampAgentSwarmWorkerCount,
  limitAgentSwarmAgentAllocations,
  normalizeAgentSwarmAgentAllocations,
  resolveAgentSwarmAgentIdForWorkerSlot,
  sumAgentSwarmAgentAllocations
} from "./agent-swarm.js";

describe("Agent Swarm allocations", () => {
  it("normalizes ids, counts, and duplicate agent rows", () => {
    expect(normalizeAgentSwarmAgentAllocations([
      { agentId: " Fast ", workerCount: 2.9 },
      { agentId: "deep", workerCount: 1 },
      { agentId: "FAST", workerCount: 1 },
      { agentId: "", workerCount: 4 },
      { agentId: "bad", workerCount: 0 }
    ])).toEqual([
      { agentId: "fast", workerCount: 3 },
      { agentId: "deep", workerCount: 1 }
    ]);
  });

  it("caps allocation totals without reordering models", () => {
    expect(limitAgentSwarmAgentAllocations([
      { agentId: "fast", workerCount: 10 },
      { agentId: "deep", workerCount: 10 }
    ])).toEqual([
      { agentId: "fast", workerCount: 10 },
      { agentId: "deep", workerCount: AGENT_SWARM_MAX_WORKERS - 10 }
    ]);
  });

  it("maps worker slots to assigned agent ids", () => {
    const allocations = [
      { agentId: "fast", workerCount: 2 },
      { agentId: "deep", workerCount: 1 },
      { agentId: "wide", workerCount: 3 }
    ];

    expect(sumAgentSwarmAgentAllocations(allocations)).toBe(6);
    expect(resolveAgentSwarmAgentIdForWorkerSlot(allocations, 0)).toBe("fast");
    expect(resolveAgentSwarmAgentIdForWorkerSlot(allocations, 1)).toBe("fast");
    expect(resolveAgentSwarmAgentIdForWorkerSlot(allocations, 2)).toBe("deep");
    expect(resolveAgentSwarmAgentIdForWorkerSlot(allocations, 5)).toBe("wide");
    expect(resolveAgentSwarmAgentIdForWorkerSlot(allocations, 6)).toBeNull();
  });

  it("clamps worker counts to the supported swarm range", () => {
    expect(clampAgentSwarmWorkerCount(0)).toBe(0);
    expect(clampAgentSwarmWorkerCount(1)).toBe(1);
    expect(clampAgentSwarmWorkerCount(99)).toBe(16);
    expect(clampAgentSwarmWorkerCount("bad")).toBe(3);
  });

  it("clamps review rounds to the supported non-negative range", () => {
    expect(clampAgentSwarmReviewRounds(-1)).toBe(0);
    expect(clampAgentSwarmReviewRounds(2.9)).toBe(2);
    expect(clampAgentSwarmReviewRounds(99)).toBe(AGENT_SWARM_MAX_REVIEW_ROUNDS);
    expect(clampAgentSwarmReviewRounds("bad")).toBe(0);
  });
});

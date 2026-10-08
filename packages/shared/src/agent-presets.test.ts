import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_AGENT_PRESETS,
  findPlatformAgentPresetById,
  getVisiblePlatformAgentPresets,
  normalizePlatformAgentPresets,
  isPlatformAgentPresetVisible,
  resolveDefaultPlatformAgentId,
  compilePlatformAgentSwarm,
  validatePlatformAgentPresetGraph
} from "./agent-presets.js";

describe("normalizePlatformAgentPresets", () => {
  it("falls back to defaults when input is not an array", () => {
    const normalized = normalizePlatformAgentPresets(null);

    expect(normalized).toEqual(DEFAULT_PLATFORM_AGENT_PRESETS);
    expect(normalized).not.toBe(DEFAULT_PLATFORM_AGENT_PRESETS);
  });

  it("deduplicates preset ids and keeps first valid item", () => {
    const normalized = normalizePlatformAgentPresets([
      {
        id: "FAST",
        name: "Fast",
        description: "Fast one",
        requiresSuperAdmin: true,
        payload: { model: "a", responses: {} }
      },
      {
        id: "fast",
        name: "Fast duplicate",
        description: "Should be ignored",
        requiresSuperAdmin: false,
        payload: { model: "b", responses: {} }
      },
      {
        id: "Deep",
        name: "Deep",
        description: "Deep mode",
        payload: { responses: { reasoning: { effort: "xhigh" } } }
      },
      {
        id: "",
        name: "Invalid",
        description: "Invalid",
        payload: {}
      }
    ]);

    expect(normalized).toEqual([
      {
        id: "fast",
        name: "Fast",
        description: "Fast one",
        requiresSuperAdmin: true,
        payload: { model: "a" }
      },
      {
        id: "deep",
        name: "Deep",
        description: "Deep mode",
        requiresSuperAdmin: false,
        payload: { responses: { reasoning: { effort: "xhigh" } } }
      }
    ]);
  });

  it("defaults requiresSuperAdmin to false when omitted", () => {
    const normalized = normalizePlatformAgentPresets([
      {
        id: "fast",
        name: "Fast",
        description: "Fast mode",
        payload: { model: "a", responses: {} }
      }
    ]);

    expect(normalized).toEqual([
      {
        id: "fast",
        name: "Fast",
        description: "Fast mode",
        requiresSuperAdmin: false,
        payload: { model: "a" }
      }
    ]);
  });

  it("preserves hidden presets without making them invalid", () => {
    const normalized = normalizePlatformAgentPresets([
      {
        id: "internal",
        name: "Internal",
        description: "Internal model",
        hidden: true,
        payload: { model: "internal-model" }
      }
    ]);

    expect(normalized[0]).toMatchObject({ id: "internal", hidden: true });
    expect(getVisiblePlatformAgentPresets(normalized, false)).toEqual(normalized);
  });

  it("preserves the spawnable node choice on Swarm presets", () => {
    const normalized = normalizePlatformAgentPresets([{
      id: "research-swarm", name: "Research swarm", description: "Three workers",
      payload: {}, mode: "agent_swarm", leaderAgentId: "luna",
      modelAllocations: [{ agentId: "luna", workerCount: 3 }], spawnableAsNode: false
    }]);

    expect(normalized[0]).toMatchObject({ id: "research-swarm", spawnableAsNode: false });
  });

  it("keeps Swarm budget defaults, and drops them when spawning and budgets are disabled", () => {
    const [withBudgets, withoutBudgets] = normalizePlatformAgentPresets([
      {
        id: "budgeted", name: "Budgeted", description: "Swarm", payload: {}, mode: "agent_swarm",
        leaderAgentId: "luna", modelAllocations: [{ agentId: "luna", workerCount: 2 }],
        tokenBudget: 20_000_000, timeBudgetMinutes: 90
      },
      {
        id: "roster-only", name: "Roster only", description: "Swarm", payload: {}, mode: "agent_swarm",
        leaderAgentId: "luna", modelAllocations: [{ agentId: "luna", workerCount: 2 }],
        tokenBudget: 20_000_000, disableSpawningAndBudgets: true
      }
    ]);

    expect(withBudgets).toMatchObject({ tokenBudget: 20_000_000, timeBudgetMinutes: 90 });
    expect(withoutBudgets).toMatchObject({ disableSpawningAndBudgets: true });
    expect(withoutBudgets.tokenBudget).toBeUndefined();
  });

  it("preserves an individual agent's explicit node opt-in", () => {
    const normalized = normalizePlatformAgentPresets([{
      id: "luna", name: "Luna", description: "Fast research", payload: {}, spawnableAsNode: true
    }]);
    expect(normalized[0]).toMatchObject({ id: "luna", spawnableAsNode: true });
  });

  it("falls back to defaults when all entries are invalid", () => {
    const normalized = normalizePlatformAgentPresets([
      { id: "", name: "Nope", description: "Nope", payload: {} },
      { id: "ok", name: "", description: "Nope", payload: {} }
    ]);

    expect(normalized).toEqual(DEFAULT_PLATFORM_AGENT_PRESETS);
  });
});

describe("resolveDefaultPlatformAgentId", () => {
  it("prefers preset id default", () => {
    const presetId = resolveDefaultPlatformAgentId([
      {
        id: "fast",
        name: "Fast",
        description: "Fast",
        requiresSuperAdmin: false,
        payload: {}
      },
      {
        id: "default",
        name: "Default",
        description: "Default",
        requiresSuperAdmin: false,
        payload: {}
      }
    ]);

    expect(presetId).toBe("default");
  });

  it("falls back to first preset when default is missing", () => {
    const presetId = resolveDefaultPlatformAgentId([
      {
        id: "fast",
        name: "Fast",
        description: "Fast",
        requiresSuperAdmin: false,
        payload: {}
      }
    ]);

    expect(presetId).toBe("fast");
  });

  it("returns null for empty lists", () => {
    expect(resolveDefaultPlatformAgentId([])).toBeNull();
  });
});

describe("findPlatformAgentPresetById", () => {
  it("normalizes lookup id", () => {
    const found = findPlatformAgentPresetById(
      [
        {
          id: "fast",
          name: "Fast",
          description: "Fast",
          requiresSuperAdmin: false,
          payload: {}
        }
      ],
      " FAST "
    );

    expect(found?.id).toBe("fast");
  });
});

describe("agent preset visibility", () => {
  it("hides super-admin presets from non-admin actors", () => {
    const presets = [
      {
        id: "default",
        name: "Default",
        description: "Default",
        requiresSuperAdmin: false,
        payload: {}
      },
      {
        id: "ops",
        name: "Ops",
        description: "Ops only",
        requiresSuperAdmin: true,
        payload: {}
      }
    ];

    expect(isPlatformAgentPresetVisible(presets[0], false)).toBe(true);
    expect(isPlatformAgentPresetVisible(presets[1], false)).toBe(false);
    expect(getVisiblePlatformAgentPresets(presets, false)).toEqual([presets[0]]);
    expect(getVisiblePlatformAgentPresets(presets, true)).toEqual(presets);
  });
});

describe("agent swarm presets", () => {
  const presets = normalizePlatformAgentPresets([
    { id: "writer", name: "Writer", description: "Writes", payload: {} },
    { id: "reviewer", name: "Reviewer", description: "Reviews", mode: "quality_control_reviewer", payload: {} },
    {
      id: "inner",
      name: "Inner swarm",
      description: "Inner",
      mode: "agent_swarm",
      leaderAgentId: "reviewer",
      modelAllocations: [{ agentId: "reviewer", workerCount: 2 }],
      payload: {}
    },
    {
      id: "root",
      name: "Root swarm",
      description: "Root",
      mode: "agent_swarm",
      leaderAgentId: "inner",
      modelAllocations: [{ agentId: "inner", workerCount: 2 }],
      payload: {}
    }
  ]);

  it("compiles nested swarms into logical nodes and leaf occurrences", () => {
    const compiled = compilePlatformAgentSwarm({
      presets,
      leaderAgentId: "writer",
      modelAllocations: [{ agentId: "inner", workerCount: 2 }],
      reviewRounds: 0
    });

    expect(compiled.nodes.length).toBeGreaterThan(1);
    expect(compiled.leaves.length).toBeGreaterThan(4);
    expect(compiled.leaves.every((leaf) => leaf.nodeIds.length <= 2)).toBe(true);
    const root = compiled.nodes.find((node) => node.id === compiled.rootNodeId);
    expect(root?.leaderLeafId).toBeTruthy();
  });

  it("compiles a leader-only swarm so it can spawn workers later", () => {
    const leaderOnly = normalizePlatformAgentPresets([
      ...presets,
      { id: "solo", name: "Solo", description: "Solo", mode: "agent_swarm",
        leaderAgentId: "writer", modelAllocations: [], payload: {} }
    ]).find((preset) => preset.id === "solo");
    expect(leaderOnly).toBeDefined();
    const compiled = compilePlatformAgentSwarm({
      presets: [...presets, leaderOnly!], leaderAgentId: leaderOnly!.leaderAgentId!, modelAllocations: []
    });
    expect(compiled.nodes).toHaveLength(1);
    expect(compiled.leaves).toHaveLength(1);
    expect(compiled.nodes[0].workerLeafIds).toEqual([]);
  });

  it("rejects a seeded roster that would create more than 256 agent loops", () => {
    const heavy = {
      id: "heavy", name: "Heavy", description: "Heavy", mode: "agent_swarm" as const,
      leaderAgentId: "writer", modelAllocations: [{ agentId: "writer", workerCount: 16 }], payload: {}
    };
    expect(() => compilePlatformAgentSwarm({
      presets: [...presets, heavy], leaderAgentId: "writer",
      modelAllocations: [{ agentId: "heavy", workerCount: 16 }]
    })).toThrow("256 agents");
  });

  it("rejects a leader that would belong to three swarms", () => {
    expect(() => compilePlatformAgentSwarm({
      presets,
      leaderAgentId: "root",
      modelAllocations: [{ agentId: "root", workerCount: 2 }]
    })).toThrow("more than two Agent Swarms");
  });

  it("rejects recursive swarm references", () => {
    const cyclic = normalizePlatformAgentPresets([
      {
        id: "a", name: "A", description: "A", mode: "agent_swarm", leaderAgentId: "b",
        modelAllocations: [{ agentId: "b", workerCount: 2 }], payload: {}
      },
      {
        id: "b", name: "B", description: "B", mode: "agent_swarm", leaderAgentId: "a",
        modelAllocations: [{ agentId: "a", workerCount: 2 }], payload: {}
      }
    ]);

    expect(validatePlatformAgentPresetGraph(cyclic).some((error) => error.includes("cycle"))).toBe(true);
  });
});

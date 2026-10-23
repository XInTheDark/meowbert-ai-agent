import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_AGENT_PRESETS,
  findPlatformAgentPresetById,
  getVisiblePlatformAgentPresets,
  normalizePlatformAgentPresets,
  isPlatformAgentPresetVisible,
  resolveDefaultPlatformAgentId,
  validatePlatformAgentPresetReferences
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

  it("fills Swarm defaults and clamps advanced settings", () => {
    const [swarm] = normalizePlatformAgentPresets([{
      id: "research-swarm", name: "Research swarm", description: "Research", payload: {},
      mode: "agent_swarm", leaderAgentId: "Luna", routerId: "Router-1", tokenBudget: 20_000_000,
      advanced: { maxLanesPerParent: 40, maxDepth: 0, laneMaxSteps: null, autoCheck: false }
    }]);

    expect(swarm).toMatchObject({
      leaderAgentId: "luna",
      routerId: "router-1",
      budgetsEnabled: false,
      tokenBudget: 20_000_000,
      advanced: { maxLanesPerParent: 16, maxDepth: 1, maxRunningLanes: 32, laneMaxSteps: null, autoCheck: false }
    });
    expect(swarm).not.toHaveProperty("modelAllocations");
  });

  it("rejects a Swarm preset without a leader", () => {
    const normalized = normalizePlatformAgentPresets([
      { id: "ok", name: "Ok", description: "Ok", payload: {} },
      { id: "leaderless", name: "Leaderless", description: "Swarm", payload: {}, mode: "agent_swarm" }
    ]);
    expect(normalized.map((preset) => preset.id)).toEqual(["ok"]);
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

describe("validatePlatformAgentPresetReferences", () => {
  it("requires a Swarm leader to be an existing single agent", () => {
    const presets = normalizePlatformAgentPresets([
      { id: "writer", name: "Writer", description: "Writes", payload: {} },
      { id: "ok", name: "Ok", description: "Swarm", mode: "agent_swarm", leaderAgentId: "writer", payload: {} },
      { id: "missing", name: "Missing", description: "Swarm", mode: "agent_swarm", leaderAgentId: "ghost", payload: {} },
      { id: "nested", name: "Nested", description: "Swarm", mode: "agent_swarm", leaderAgentId: "ok", payload: {} }
    ]);

    const errors = validatePlatformAgentPresetReferences(presets);
    expect(errors).toHaveLength(2);
    expect(errors.some((error) => error.includes("missing") && error.includes("ghost"))).toBe(true);
    expect(errors.some((error) => error.includes("nested"))).toBe(true);
  });
});

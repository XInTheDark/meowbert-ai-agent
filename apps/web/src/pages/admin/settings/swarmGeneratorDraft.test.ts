import { describe, expect, it } from "vitest";
import {
  createSwarmDraft,
  validateGeneratedSwarmPresets,
  type SwarmDraft,
  type SwarmModelOption
} from "./swarmGeneratorDraft";

const models: SwarmModelOption[] = [
  { id: "leader-model", name: "Leader" },
  { id: "worker-model", name: "Worker" }
];

function validSwarm(key: string, id: string): SwarmDraft {
  return {
    ...createSwarmDraft(key), id, name: id,
    leader: { kind: "model", agentId: "leader-model" },
    workers: [
      { kind: "model", agentId: "worker-model" },
      { kind: "model", agentId: "worker-model" }
    ]
  };
}

describe("agent swarm generator", () => {
  it("generates nested swarm presets in dependency order", () => {
    const inner = validSwarm("inner", "inner-swarm");
    const root = validSwarm("root", "outer-swarm");
    root.workers[0] = { kind: "swarm", swarm: inner };
    const generated = validateGeneratedSwarmPresets(root, models, []);
    expect(generated.map((preset) => preset.id)).toEqual(["inner-swarm", "outer-swarm"]);
    expect(generated.map((preset) => preset.spawnableAsNode)).toEqual([false, false]);
    expect(generated[1]).toMatchObject({
      leaderAgentId: "leader-model",
      modelAllocations: [
        { agentId: "inner-swarm", workerCount: 1 },
        { agentId: "worker-model", workerCount: 1 }
      ]
    });
  });

  it("accepts a swarm in the leader seat with one shared leader model", () => {
    const inner = validSwarm("inner", "inner-swarm");
    const root = validSwarm("root", "outer-swarm");
    root.leader = { kind: "swarm", swarm: inner };
    expect(validateGeneratedSwarmPresets(root, models, [])).toHaveLength(2);
  });

  it("blocks incomplete swarms and IDs already in use", () => {
    const root = validSwarm("root", "outer-swarm");
    expect(() => validateGeneratedSwarmPresets(root, models, ["outer-swarm"]))
      .toThrow("already exists");
    root.workers = [];
    expect(validateGeneratedSwarmPresets(root, models, [])[0]?.modelAllocations).toEqual([]);
    root.leader = null;
    expect(() => validateGeneratedSwarmPresets(root, models, [])).toThrow("needs a leader");
  });

  it("lets an admin explicitly enable a flat Swarm preset for leader spawn choices", () => {
    const root = validSwarm("root", "research-swarm");
    root.spawnableAsNode = true;
    expect(validateGeneratedSwarmPresets(root, models, [])[0]?.spawnableAsNode).toBe(true);
  });

  it("rejects a leader shared by three swarms", () => {
    const root = validSwarm("root", "outer-swarm");
    const inner = validSwarm("inner", "inner-swarm");
    inner.leader = { kind: "swarm", swarm: validSwarm("deep", "deep-swarm") };
    root.workers[0] = { kind: "swarm", swarm: inner };
    expect(() => validateGeneratedSwarmPresets(root, models, []))
      .toThrow("at most two swarms");
  });

  it("rejects preset text that the server would drop", () => {
    const root = validSwarm("root", "outer-swarm");
    root.name = "x".repeat(241);
    expect(() => validateGeneratedSwarmPresets(root, models, []))
      .toThrow("240 characters or less");
  });
});

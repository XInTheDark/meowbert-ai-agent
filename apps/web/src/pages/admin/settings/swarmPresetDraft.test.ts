import { describe, expect, it } from "vitest";
import { applySwarmPresetForm, buildEmptySwarmPresetForm, listLeaderOptions, listSwarmPresetForms } from "./swarmPresetDraft";

const presets = JSON.stringify([
  { id: "luna", name: "Luna", description: "", requiresSuperAdmin: false, payload: { model: "gpt" } },
  { id: "research", name: "Research", description: "Swarm", requiresSuperAdmin: true, payload: {}, mode: "agent_swarm",
    leaderAgentId: "luna", budgetsEnabled: true, tokenBudget: 5_000_000 }
]);

describe("swarm preset editor drafts", () => {
  it("reads swarm presets as fields and offers only single agents as leaders", () => {
    expect(listSwarmPresetForms(presets).map((form) => [form.id, form.leaderAgentId, form.tokenBudget])).toEqual([["research", "luna", "5000000"]]);
    expect(listLeaderOptions(presets).map((option) => option.id)).toEqual(["luna"]);
  });

  it("writes an edited preset back in place, keeping fields the editor does not show", () => {
    const [form] = listSwarmPresetForms(presets);
    const result = applySwarmPresetForm(presets, { ...form, routerId: "router-v1", tokenBudget: "" }, "research");
    const records = JSON.parse(result.json!) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ id: "research", requiresSuperAdmin: true, routerId: "router-v1", mode: "agent_swarm" });
    expect(records[1]).not.toHaveProperty("tokenBudget");
  });

  it("adds a new preset and refuses one without a leader or with a taken ID", () => {
    const form = { ...buildEmptySwarmPresetForm(), id: "writing", leaderAgentId: "luna" };
    expect(JSON.parse(applySwarmPresetForm(presets, form, null).json!)).toHaveLength(3);
    expect(applySwarmPresetForm(presets, { ...form, leaderAgentId: "" }, null).error).toMatch(/leader/);
    expect(applySwarmPresetForm(presets, { ...form, id: "luna" }, null).error).toMatch(/already uses/);
  });
});

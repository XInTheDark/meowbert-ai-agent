import { describe, expect, it } from "vitest";
import { parseAgentPresetsDraft } from "./adminSettingsDrafts";

describe("agent preset draft", () => {
  it("keeps an individual agent's node opt-in when saving admin settings", () => {
    const presets = parseAgentPresetsDraft(JSON.stringify([{
      id: "luna", name: "Luna", description: "Focused research",
      requiresSuperAdmin: false, payload: { model: "gpt-6-luna" }, spawnableAsNode: true
    }]));

    expect(presets[0]).toMatchObject({ id: "luna", spawnableAsNode: true });
  });
});

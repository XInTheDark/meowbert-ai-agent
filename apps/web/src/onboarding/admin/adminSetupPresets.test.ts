import { describe, expect, it } from "vitest";
import { buildSetupAgentPresets } from "./adminSetupPresets";

describe("buildSetupAgentPresets", () => {
  it("makes the first model the default preset and gives the rest unique ids", () => {
    const presets = buildSetupAgentPresets([
      { modelId: "gpt-5.5", reasoningEffort: "medium" },
      { modelId: "Qwen/Qwen3 32B", reasoningEffort: "off" },
      { modelId: "qwen-qwen3-32b", reasoningEffort: "low" }
    ]);

    expect(presets.map((preset) => preset.id)).toEqual(["default", "qwen-qwen3-32b", "qwen-qwen3-32b-2"]);
    expect(presets.map((preset) => preset.name)).toEqual(["gpt-5.5", "Qwen/Qwen3 32B", "qwen-qwen3-32b"]);
  });

  it("only sends reasoning settings to models that have reasoning turned on", () => {
    const [reasoning, plain] = buildSetupAgentPresets([
      { modelId: "o-model", reasoningEffort: "high" },
      { modelId: "chat-model", reasoningEffort: "off" }
    ]);

    expect(reasoning.payload).toEqual({ model: "o-model", responses: { reasoning: { effort: "high", summary: "auto" } } });
    expect(plain.payload).toEqual({ model: "chat-model" });
  });
});

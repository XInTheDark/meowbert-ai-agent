import { describe, expect, it } from "vitest";
import { buildSystemPrompt, type SystemPromptRuntimeOptions } from "./prompt.js";

const baseRuntimeOptions: SystemPromptRuntimeOptions = {
  allowFinalResponse: true,
  allowStopTask: false,
  allowWaitTool: false,
  allowScheduleTools: false,
  allowSubtaskTools: false
};

describe("buildSystemPrompt", () => {
  it("falls back to the default prompt for an unknown personality id", () => {
    const defaultPrompt = buildSystemPrompt("/task", "/env", "/workspace", {}, baseRuntimeOptions);
    const unknownPersonalityPrompt = buildSystemPrompt(
      "/task",
      "/env",
      "/workspace",
      { default_context: { personality: "does-not-exist" } },
      baseRuntimeOptions
    );

    expect(unknownPersonalityPrompt).toBe(defaultPrompt);
  });
});

import { describe, expect, it } from "vitest";
import { buildCanvasDesignGuidance } from "./design-guidance.js";
import { buildSystemPrompt, type SystemPromptRuntimeOptions } from "./prompt.js";
import { buildSkillEnabledPromptDelta } from "./skill-prompt.js";

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

  it("carries the canvas design guidance once: in the base prompt, or in the enabled Canvas skill", () => {
    const guidance = buildCanvasDesignGuidance();
    const canvasOptions = { ...baseRuntimeOptions, allowInteractiveCanvasTools: true };
    const skillDelta = buildSkillEnabledPromptDelta({
      skillId: "html-canvas",
      doc: "{{CANVAS_DESIGN_GUIDANCE}}",
      toolNames: []
    });

    expect(buildSystemPrompt("/task", "/env", "/workspace", {}, canvasOptions)).toContain(guidance);
    expect(
      buildSystemPrompt("/task", "/env", "/workspace", {}, { ...canvasOptions, canvasDesignGuidanceInSkill: true })
    ).not.toContain(guidance);
    expect(skillDelta).toContain(guidance);
  });
});

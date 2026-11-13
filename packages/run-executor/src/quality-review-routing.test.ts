import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCheckPrompt } from "./agent-swarm/prompt.js";
import { buildQualityReviewPrompt } from "./quality-review-prompt.js";
import { buildWorkflowPromptContext } from "./task-workflows/prompts.js";
import type { LoadedWorkflowRunContext } from "./task-workflows/context-types.js";

vi.mock("./quality-review-prompt.js", () => ({ buildQualityReviewPrompt: vi.fn(() => "shared-review-criteria") }));

describe("shared quality review routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the shared criteria with no repair authority for Thorough Check only", () => {
    const standard = loadCheckPrompt();
    expect(buildQualityReviewPrompt).not.toHaveBeenCalled();
    expect(loadCheckPrompt("standard")).toBe(standard);
    const thorough = loadCheckPrompt("thorough");
    expect(buildQualityReviewPrompt).toHaveBeenCalledExactlyOnceWith(null, false);
    expect(thorough).toContain("shared-review-criteria");
    expect(standard).not.toContain("shared-review-criteria");
  });

  it("uses the same shared criteria with the existing repair authority in Quality Control", () => {
    const context = {
      config: { reviewMode: "quality_control" }, taskDir: "/lane", workflowTaskDir: "/main",
      planContent: null, longHorizon: null
    } as unknown as LoadedWorkflowRunContext;
    const prompt = buildWorkflowPromptContext(context, "quality_control_reviewer");
    expect(buildQualityReviewPrompt).toHaveBeenCalledExactlyOnceWith("/main");
    expect(prompt.section).toContain("shared-review-criteria");
  });
});

import { describe, expect, it } from "vitest";
import {
  normalizePlatformSpecializedModels,
  resolveFastModel,
  resolveInternalModel
} from "./specialized-models.js";

describe("platform specialized models", () => {
  it("normalizes only non-empty model identifiers", () => {
    expect(normalizePlatformSpecializedModels({
      fastModel: "  gpt-fast  ",
      memorySynthesisAgent: "  memory-refresh  ",
      reviewerAgent: "  quality-review  "
    })).toEqual({
      internalModel: null,
      fastModel: "gpt-fast",
      memorySynthesisAgent: "memory-refresh",
      reviewerAgent: "quality-review",
      subagentFastAgent: null
    });
  });

  it("falls back to the resolved task model when no fast model is configured", () => {
    expect(resolveFastModel({
      specializedModels: { internalModel: null, fastModel: null, memorySynthesisAgent: null, reviewerAgent: null, subagentFastAgent: null },
      fallbackModel: "gpt-task"
    })).toBe("gpt-task");
    expect(resolveFastModel({
      specializedModels: { internalModel: null, fastModel: "gpt-fast", memorySynthesisAgent: "memory-refresh", reviewerAgent: "quality-review", subagentFastAgent: null },
      fallbackModel: "gpt-task"
    })).toBe("gpt-fast");
  });

  it("uses the configured internal model, or the server default when none is set", () => {
    const unset = normalizePlatformSpecializedModels({});
    expect(resolveInternalModel({ specializedModels: unset, fallbackModel: "config-default" })).toBe("config-default");
    expect(resolveInternalModel({
      specializedModels: normalizePlatformSpecializedModels({ internalModel: " gpt-mini " }),
      fallbackModel: "config-default"
    })).toBe("gpt-mini");
  });
});

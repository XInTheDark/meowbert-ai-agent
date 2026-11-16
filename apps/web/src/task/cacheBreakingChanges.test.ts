import { describe, expect, it } from "vitest";
import { findCacheBreakingChanges } from "./cacheBreakingChanges";
import type { TaskMessageSetup } from "./taskMessageSetup";

const tools = { webSearch: false, memorySearch: false, scheduleTask: false, subtasks: false, computerUse: false,
  interactiveCanvas: false, enabledSkills: [], enabledSources: [] };
const previous: TaskMessageSetup = { messageId: "m1", toolOptions: tools, agentId: "opus" };

describe("findCacheBreakingChanges", () => {
  it("ignores tool changes the agent can be told about", () => {
    expect(findCacheBreakingChanges(previous, {
      toolOptions: { ...tools, webSearch: true, enabledSkills: ["html-canvas"] }, agentId: "opus"
    })).toEqual([]);
  });

  it("flags a different agent and newly enabled computer use", () => {
    expect(findCacheBreakingChanges(previous, { toolOptions: { ...tools, computerUse: true }, agentId: "gpt" }))
      .toEqual(["agent", "computer_use"]);
  });

  it("has nothing to break before the first message", () => {
    expect(findCacheBreakingChanges(null, { toolOptions: { ...tools, computerUse: true }, agentId: "gpt" })).toEqual([]);
  });
});

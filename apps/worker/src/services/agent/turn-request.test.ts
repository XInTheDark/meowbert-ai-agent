import { describe, expect, it } from "vitest";
import type { FunctionTool } from "openai/resources/responses/responses";
import { buildAgentTurnRequest, buildPromptCacheKey } from "./turn-request.js";
import { createPromptEnvelope } from "./prompt-envelope.js";
import {
  CREATE_CHANNEL_TOOL_NAME,
  LIST_CHANNELS_TOOL_NAME,
  READ_CHANNEL_TOOL_NAME,
  REFRESH_INBOX_TOOL_NAME,
  SEND_CHANNEL_MESSAGE_TOOL_NAME
} from "../agent-tools/index.js";

function createBaseToolOptions() {
  return {
    webSearch: false,
    memorySearch: false,
    scheduleTask: false,
    subtasks: false,
    computerUse: false,
    enabledSkills: [],
    enabledSources: []
  };
}

describe("buildPromptCacheKey", () => {
  it("varies by prompt prefix hash so tool changes do not reuse stale cached prefixes", () => {
    expect(buildPromptCacheKey("task-1", "hash-a")).not.toBe(buildPromptCacheKey("task-1", "hash-b"));
  });

  it("hashes cache keys into OpenAI's prompt cache key length limit", () => {
    const key = buildPromptCacheKey("550e8400-e29b-41d4-a716-446655440000", "12345678901234567890");

    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves task variation", () => {
    expect(buildPromptCacheKey("task-1", "hash-a")).not.toBe(buildPromptCacheKey("task-2", "hash-a"));
  });

  it("keeps unexpectedly long inputs within the length limit", () => {
    const taskId = "task-with-a-nonstandard-id-that-is-too-long-for-openai-prompt-cache-keys";
    const key = buildPromptCacheKey(taskId, "hash-a");

    expect(key).toHaveLength(64);
  });
});

describe("buildAgentTurnRequest", () => {
  it("injects enabled skill tools into the next model tool array", () => {
    const promptEnvelope = createPromptEnvelope("Base prompt.");
    const skillTool: FunctionTool = {
      type: "function",
      name: "pptx-studio__pptx_draw_slide_svg",
      description: "Draw an SVG visual for a slide.",
      strict: false,
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    };

    const beforeEnable = buildAgentTurnRequest({
      taskId: "task-1",
      runToolOptions: createBaseToolOptions(),
      activeSkillTools: [],
      promptEnvelope,
      availability: {}
    });
    const afterEnable = buildAgentTurnRequest({
      taskId: "task-1",
      runToolOptions: createBaseToolOptions(),
      activeSkillTools: [skillTool],
      promptEnvelope,
      availability: {}
    });

    expect(beforeEnable.responseTools.some((tool) => tool.type === "function" && tool.name === skillTool.name)).toBe(false);
    expect(afterEnable.responseTools.some((tool) => tool.type === "function" && tool.name === skillTool.name)).toBe(true);
    expect(afterEnable.promptPrefixHash).not.toBe(beforeEnable.promptPrefixHash);
    expect(afterEnable.promptCacheKey).not.toBe(beforeEnable.promptCacheKey);
  });

  it("keeps the code mode tool list, and so the cache key, the same when a skill or tool group loads", () => {
    const promptEnvelope = createPromptEnvelope("Base prompt.");
    const skillTool: FunctionTool = {
      type: "function",
      name: "pptx_studio__pptx_draw_slide_svg",
      description: "Draw an SVG visual for a slide.",
      strict: false,
      parameters: { type: "object", properties: {}, required: [] }
    };
    const request = (activeSkillTools: FunctionTool[], loadedToolGroups: string[]) => buildAgentTurnRequest({
      taskId: "task-1",
      runToolOptions: { ...createBaseToolOptions(), scheduleTask: true },
      activeSkillTools,
      promptEnvelope,
      availability: { allowScheduleTools: true, loadedToolGroups },
      codeMode: true
    });

    const before = request([], []);
    const after = request([skillTool], ["task-scheduling"]);

    expect(after.responseTools).toEqual(before.responseTools);
    expect(after.promptCacheKey).toBe(before.promptCacheKey);
    expect(after.codeModeTools.map((tool) => tool.name)).toEqual(expect.arrayContaining([skillTool.name, "schedule_task"]));
  });

  it("passes agent swarm tools through to the model request when enabled", () => {
    const promptEnvelope = createPromptEnvelope("Base prompt.");
    const request = buildAgentTurnRequest({
      taskId: "task-1",
      runToolOptions: createBaseToolOptions(),
      activeSkillTools: [],
      promptEnvelope,
      availability: {
        allowSwarmTools: true
      }
    });

    const toolNames = request.responseTools
      .filter((tool) => tool.type === "function")
      .map((tool) => tool.name);

    expect(toolNames).toContain(REFRESH_INBOX_TOOL_NAME);
    expect(toolNames).toContain(LIST_CHANNELS_TOOL_NAME);
    expect(toolNames).toContain(READ_CHANNEL_TOOL_NAME);
    expect(toolNames).toContain(CREATE_CHANNEL_TOOL_NAME);
    expect(toolNames).toContain(SEND_CHANNEL_MESSAGE_TOOL_NAME);
  });
});

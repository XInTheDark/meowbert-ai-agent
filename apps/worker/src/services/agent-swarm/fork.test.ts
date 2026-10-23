import { describe, expect, it } from "vitest";
import { buildAgentTurnRequest } from "../agent/turn-request.js";
import { appendPromptEnvelopeDelta, createPromptEnvelope, sealPromptEnvelope } from "../agent/prompt-envelope.js";
import { SWARM_TOOL_NAMES } from "../agent-tools/swarm.js";
import { restoreForkEnvelope, snapshotForkEnvelope } from "./fork-seed.js";

const toolOptions = {
  webSearch: true,
  memorySearch: false,
  scheduleTask: false,
  subtasks: false,
  computerUse: false,
  enabledSkills: [],
  enabledSources: []
};

function leaderTurn() {
  const envelope = createPromptEnvelope("You are Meowbert.");
  appendPromptEnvelopeDelta(envelope, { reason: "workflow-guide", role: "developer", content: "Agent Swarm guide." });
  const request = buildAgentTurnRequest({
    taskId: "root-task",
    cacheTaskId: "root-task",
    runToolOptions: toolOptions,
    activeSkillTools: [],
    promptEnvelope: envelope,
    availability: { allowFinalResponse: true, allowWaitTool: true, swarmTools: "all", contextManagementVersion: "v2" }
  });
  sealPromptEnvelope(envelope);
  // Something raised after the first request is queued for the conversation, never the prefix.
  appendPromptEnvelopeDelta(envelope, { reason: "skill_enabled", content: "A skill was enabled mid-run." });
  return { envelope, request };
}

function laneTurn(seed: ReturnType<typeof snapshotForkEnvelope>, tools: ReturnType<typeof leaderTurn>["request"]["responseTools"]) {
  const envelope = restoreForkEnvelope(seed);
  // A lane's own setup raises notes too; they must not reach its inherited prefix.
  appendPromptEnvelopeDelta(envelope, { reason: "desktop-computer-unavailable", content: "No desktop." });
  return buildAgentTurnRequest({
    taskId: "lane-task",
    cacheTaskId: "root-task",
    runToolOptions: { ...toolOptions, webSearch: false },
    activeSkillTools: [],
    promptEnvelope: envelope,
    availability: { allowFinalResponse: false, allowWaitTool: false },
    fixedTools: { response: tools, codeMode: [] }
  });
}

describe("forked lane requests", () => {
  it("repeat the parent's tools and prefix, share its cache key, and keep their own session affinity", () => {
    const { envelope, request: parent } = leaderTurn();
    const seed = snapshotForkEnvelope(envelope);
    const lane = laneTurn(seed, parent.responseTools);

    expect(lane.responseTools).toEqual(parent.responseTools);
    expect(lane.promptPrefixItems).toEqual(parent.promptPrefixItems);
    expect(lane.promptPrefixHash).toBe(parent.promptPrefixHash);
    expect(lane.promptCacheKey).toBe(parent.promptCacheKey);
    expect(lane.sessionAffinityKey).not.toBe(parent.sessionAffinityKey);
  });

  it("keep the same prefix on every run of the lane", () => {
    const { envelope, request: parent } = leaderTurn();
    const seed = snapshotForkEnvelope(envelope);

    expect(laneTurn(structuredClone(seed), parent.responseTools).promptPrefixHash)
      .toBe(laneTurn(structuredClone(seed), parent.responseTools).promptPrefixHash);
  });

  it("offer the swarm tools to the leader", () => {
    const { request } = leaderTurn();
    const names = request.responseTools.flatMap((tool) => tool.type === "function" ? [tool.name] : []);

    expect(names).toEqual(expect.arrayContaining([...SWARM_TOOL_NAMES]));
  });
});

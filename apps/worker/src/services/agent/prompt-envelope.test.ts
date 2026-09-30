import { describe, expect, it } from "vitest";
import type { Tool } from "openai/resources/responses/responses";
import {
  appendPromptEnvelopeDelta,
  computePromptPrefixHash,
  createPromptEnvelope,
  getPromptEnvelopeRevision,
  promptEnvelopeToPrefixItems
} from "./prompt-envelope.js";

describe("prompt-envelope", () => {
  it("creates a developer base frame and revision metadata", () => {
    const envelope = createPromptEnvelope("Be concise.");
    expect(envelope.baseFrames).toHaveLength(1);
    expect(envelope.baseFrames[0]).toMatchObject({
      role: "developer",
      content: "Be concise."
    });
    expect(getPromptEnvelopeRevision(envelope)).toBe("task-agent-base-v1+d0");
  });

  it("appends prompt deltas without mutating prior frames", () => {
    const envelope = createPromptEnvelope("Base prompt.");
    const delta = appendPromptEnvelopeDelta(envelope, {
      reason: "skill_enabled",
      role: "system",
      content: "Skill tools are available."
    });

    expect(delta).not.toBeNull();
    expect(envelope.baseFrames).toHaveLength(1);
    expect(envelope.deltas).toHaveLength(1);
    expect(promptEnvelopeToPrefixItems(envelope)).toEqual([
      { role: "developer", content: "Base prompt." },
      { role: "system", content: "Skill tools are available." }
    ]);
    expect(getPromptEnvelopeRevision(envelope)).toBe("task-agent-base-v1+d1");
  });

  it("deduplicates identical adjacent deltas", () => {
    const envelope = createPromptEnvelope("Base prompt.");
    const first = appendPromptEnvelopeDelta(envelope, {
      reason: "skill_enabled",
      content: "Skill alpha enabled."
    });
    const second = appendPromptEnvelopeDelta(envelope, {
      reason: "skill_enabled",
      content: "Skill alpha enabled."
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(envelope.deltas).toHaveLength(1);
  });

  it("computes stable prefix hashes regardless of tool array order", () => {
    const envelope = createPromptEnvelope("Base prompt.");
    appendPromptEnvelopeDelta(envelope, {
      reason: "runtime_update",
      content: "Use task aliases."
    });

    const toolsA: Tool[] = [
      {
        type: "function",
        name: "beta_tool",
        description: "beta",
        strict: true,
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false
        }
      } as Tool,
      {
        type: "web_search",
        search_context_size: "high"
      } as unknown as Tool,
      {
        type: "function",
        name: "alpha_tool",
        description: "alpha",
        strict: true,
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false
        }
      } as Tool
    ];

    const toolsB = [toolsA[1], toolsA[2], toolsA[0]];

    const hashA = computePromptPrefixHash({
      envelope,
      tools: toolsA
    });
    const hashB = computePromptPrefixHash({
      envelope,
      tools: toolsB
    });

    expect(hashA).toBe(hashB);
  });
});

import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { normalizeProviderRequestInput } from "./provider-request-input.js";

describe("normalizeProviderRequestInput", () => {
  it("keeps appended Google instructions at the tail without changing the normalized prefix", () => {
    const initial = [
      { role: "developer", content: "Stable policy" },
      { role: "system", content: [{ type: "input_text", text: "Stable tools" }] },
      { role: "user", content: "Task" },
      { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "Done" }
    ] as ResponseInputItem[];
    const before = normalizeProviderRequestInput(initial, "google");
    const after = normalizeProviderRequestInput([...initial,
      { role: "developer", content: "Write notes now" },
      { role: "system", content: "Current budget" }
    ], "google");
    expect(after).toEqual([...before,
      { role: "user", content: "Write notes now" },
      { role: "user", content: "Current budget" }
    ]);
  });

  it("does not promote a tail notice when there was no leading instruction", () => {
    expect(normalizeProviderRequestInput([
      { role: "user", content: "Task" }, { role: "developer", content: "Notice" }
    ], "google")).toEqual([
      { role: "user", content: "Task" }, { role: "user", content: "Notice" }
    ]);
  });

  it("repairs function_call items missing arguments", () => {
    const malformedCall = {
      type: "function_call",
      call_id: "call_1",
      name: "shell"
    } as unknown as ResponseInputItem;

    const output = normalizeProviderRequestInput([malformedCall], "openai");

    expect(output).toEqual([
      {
        type: "function_call",
        call_id: "call_1",
        name: "shell",
        arguments: "{}"
      }
    ]);
    expect(output[0]).not.toBe(malformedCall);
  });

  it("preserves valid function_call arguments", () => {
    const validCall = {
      type: "function_call",
      call_id: "call_1",
      name: "shell",
      arguments: "{\"command\":\"pwd\"}"
    } as ResponseInputItem;
    const input = [validCall];

    const output = normalizeProviderRequestInput(input, "openai");

    expect(output).toBe(input);
    expect(output[0]).toBe(validCall);
  });

  it("repairs arguments before Google tool-output adjacency normalization", () => {
    const malformedCall = {
      type: "function_call",
      call_id: "call_1",
      name: "view_image"
    } as unknown as ResponseInputItem;
    const observation = {
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,abc" }]
    } as unknown as ResponseInputItem;
    const toolOutput = {
      type: "function_call_output",
      call_id: "call_1",
      output: "{\"ok\":true}"
    } as ResponseInputItem;

    const output = normalizeProviderRequestInput([malformedCall, observation, toolOutput], "google");

    expect(output).toEqual([
      {
        type: "function_call",
        call_id: "call_1",
        name: "view_image",
        arguments: "{}"
      },
      toolOutput,
      observation
    ]);
  });

  it("merges Google system and developer messages into one leading system message", () => {
    const input = [
      {
        role: "developer",
        content: "Follow the run policy."
      },
      {
        role: "system",
        content: "Skill tools are available."
      },
      {
        role: "user",
        content: "Fix the issue."
      }
    ] as ResponseInputItem[];

    const output = normalizeProviderRequestInput(input, "google", ["noDeveloperMessages"]);

    expect(output).toEqual([
      {
        role: "system",
        content: "Follow the run policy.\n\nSkill tools are available."
      },
      {
        role: "user",
        content: "Fix the issue."
      }
    ]);
  });

  it("keeps the system prompt as system and later notices in place as user turns for Claude", () => {
    const output = normalizeProviderRequestInput([
      { role: "developer", content: "Policy" },
      { role: "system", content: "Tools" },
      { role: "user", content: "Task" },
      { role: "assistant", content: "Done" },
      { role: "developer", content: "[Current task setup] web search on" },
      { role: "system", content: "Budget" }
    ] as ResponseInputItem[], "claude", ["noDeveloperMessages"]);

    expect(output).toEqual([
      { role: "system", content: "Policy" },
      { role: "system", content: "Tools" },
      { role: "user", content: "Task" },
      { role: "assistant", content: "Done" },
      { role: "user", content: "[Current task setup] web search on" },
      { role: "user", content: "Budget" }
    ]);
  });

  it("keeps a compaction summary after the prompt prefix out of the Claude system prompt", () => {
    const prefix = [
      { role: "developer", content: "Policy" },
      { role: "system", content: "Tools" }
    ] as ResponseInputItem[];
    const output = normalizeProviderRequestInput([
      ...prefix,
      { role: "system", content: "## Context Compaction\n\nSummary" },
      { type: "function_call_output", call_id: "c1", output: "Brief" }
    ] as ResponseInputItem[], "claude", ["noDeveloperMessages"], prefix.length);

    expect(output.slice(0, 3)).toEqual([
      { role: "system", content: "Policy" },
      { role: "system", content: "Tools" },
      { role: "user", content: "## Context Compaction\n\nSummary" }
    ]);
  });

  it("treats every leading instruction as the system prompt when the prefix length is unknown", () => {
    expect(normalizeProviderRequestInput([
      { role: "system", content: "Instructions" },
      { role: "system", content: "More" },
      { role: "user", content: "Task" }
    ] as ResponseInputItem[], "claude", ["noDeveloperMessages"])).toEqual([
      { role: "system", content: "Instructions" },
      { role: "system", content: "More" },
      { role: "user", content: "Task" }
    ]);
  });

  it.each([
    ["openai", []],
    ["claude", []],
    ["claude", ["noDeveloperMessages"]]
  ] as const)("keeps the cached prefix identical across an urgent interrupt & resume for %s (%j)", (modelType, compatibility) => {
    const prefix = [
      { role: "developer", content: "System policy" },
      { role: "system", content: "Swarm guide" }
    ] as ResponseInputItem[];
    const priorHistory = [
      { role: "user", content: "Run training" },
      { type: "function_call", call_id: "call_wait", name: "wait", arguments: "{\"seconds\":1200}" }
    ] as ResponseInputItem[];
    const resumedTail = [
      { type: "function_call_output", call_id: "call_wait", output: "{\"error\":\"interrupted\"}" },
      { role: "system", content: "[System: The previous run was interrupted while these tool calls were running.]" },
      { role: "user", content: "[Message from your parent]\nStop training now." }
    ] as ResponseInputItem[];

    const before = normalizeProviderRequestInput([...prefix, ...priorHistory], modelType, [...compatibility], prefix.length);
    const after = normalizeProviderRequestInput([...prefix, ...priorHistory, ...resumedTail], modelType, [...compatibility], prefix.length);

    expect(after.slice(0, before.length)).toEqual(before);
    if (modelType === "claude") {
      // Interrupted notice must stay a user turn at the tail so Claude proxies never hoist it into the system prompt.
      expect(after[before.length + 1]).toEqual({
        role: "user",
        content: "[System: The previous run was interrupted while these tool calls were running.]"
      });
    }
  });
});

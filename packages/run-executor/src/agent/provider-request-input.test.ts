import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { normalizeProviderRequestInput } from "./provider-request-input.js";

describe("normalizeProviderRequestInput", () => {
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
});

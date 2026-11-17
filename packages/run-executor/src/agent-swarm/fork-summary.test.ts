import { describe, expect, it } from "vitest";
import type { ModelGatewayRequest } from "../agent/ports/model-gateway.js";
import { summarizeFromParentTurn, type ParentTurnRequest } from "./fork-summary.js";

function parentRequest(...outputs: unknown[][]): { parent: ParentTurnRequest; requests: ModelGatewayRequest[] } {
  const requests: ModelGatewayRequest[] = [];
  const parent: ParentTurnRequest = {
    models: {
      create: async (request) => {
        requests.push(request);
        const output = outputs[Math.min(requests.length, outputs.length) - 1];
        return { response: { output, usage: null } as never, weightedTokens: null };
      },
      isQuotaExceeded: async () => false
    },
    chatGptCodex: false,
    promptCacheKey: "cache-key",
    sessionAffinityKey: "leader-session",
    prefixItems: [{ role: "developer", content: "Setup" }],
    modelPayload: {},
    tools: [{ type: "function", name: "exec", parameters: {}, strict: true }],
    toolChoice: "auto"
  };
  return { parent, requests };
}

const conversation = [{ role: "user" as const, content: "Train the model" }];

describe("summarizeFromParentTurn", () => {
  it("replays the parent's request as a fork of its session so it reads the parent's cache", async () => {
    const { parent, requests } = parentRequest([
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Handoff" }] }
    ]);

    await expect(summarizeFromParentTurn(parent, conversation)).resolves.toBe("Handoff");

    const [request] = requests;
    const input = request.body.input as unknown[];
    expect(input.slice(0, 2)).toEqual([...parent.prefixItems, ...conversation]);
    expect(input).toHaveLength(3);
    expect(request.body.prompt_cache_key).toBe("cache-key");
    expect(request.body.tools).toEqual(parent.tools);
    expect(request.body.tool_choice).toBe("auto");
    expect(request.headers?.["x-meridian-fork-from"]).toBe("leader-session");
    expect(request.headers?.["x-session-affinity"]).not.toBe("leader-session");
  });

  it("answers a tool call with null and keeps asking in the same session", async () => {
    const call = { type: "function_call", call_id: "call-1", name: "exec", arguments: "{}" };
    const { parent, requests } = parentRequest(
      [call],
      [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Handoff" }] }]
    );

    await expect(summarizeFromParentTurn(parent, conversation)).resolves.toBe("Handoff");

    expect(requests).toHaveLength(2);
    const [first, second] = requests.map((request) => request.body.input as unknown[]);
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second.slice(first.length)).toEqual([call, { type: "function_call_output", call_id: "call-1", output: "null" }]);
    expect(requests[1].headers?.["x-session-affinity"]).toBe(requests[0].headers?.["x-session-affinity"]);
  });

  it("gives up when the model keeps calling tools", async () => {
    const { parent, requests } = parentRequest([
      { type: "function_call", call_id: "call-1", name: "exec", arguments: "{}" }
    ]);

    await expect(summarizeFromParentTurn(parent, conversation)).resolves.toBeNull();
    expect(requests).toHaveLength(3);
  });
});

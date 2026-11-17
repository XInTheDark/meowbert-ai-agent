import { describe, expect, it } from "vitest";
import type { ModelGatewayRequest } from "../agent/ports/model-gateway.js";
import { summarizeFromParentTurn, type ParentTurnRequest } from "./fork-summary.js";

function parentRequest(output: unknown[]): { parent: ParentTurnRequest; requests: ModelGatewayRequest[] } {
  const requests: ModelGatewayRequest[] = [];
  const parent: ParentTurnRequest = {
    models: {
      create: async (request) => {
        requests.push(request);
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

  it("gives up when the model calls a tool instead of answering", async () => {
    const { parent } = parentRequest([
      { type: "function_call", call_id: "call-1", name: "exec", arguments: "{}" }
    ]);

    await expect(summarizeFromParentTurn(parent, conversation)).resolves.toBeNull();
  });
});

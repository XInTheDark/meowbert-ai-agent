import { describe, expect, it } from "vitest";
import type { FunctionTool } from "openai/resources/responses/responses";
import type { PlatformModelRouter } from "@meowbert/shared";
import { buildSwarmFunctionTools } from "@meowbert/run-executor/agent-tools/swarm";
import { inheritedItems } from "./lane-setup.js";
import { applyLaneModelRoute, buildLaneModelRoute, pickCheckModelRoute } from "./model-route.js";
import { SwarmToolError } from "./tool-error.js";

const router: PlatformModelRouter = {
  id: "router",
  routingModel: "mini",
  defaultTargetModel: "strong",
  allowReasoningEffort: true,
  models: [
    { id: "strong", description: "Hard work.", model: "gpt-strong", payload: {} },
    { id: "other", description: "A second opinion.", model: "claude-other", payload: { responses: { temperature: 0.2 } } }
  ]
};

function laneEntryProperties(tool: FunctionTool | undefined): Record<string, unknown> {
  const lanes = (tool?.parameters as { properties: { lanes: { items: { properties: Record<string, unknown> } } } }).properties.lanes;
  return lanes.items.properties;
}

describe("lane model picks", () => {
  it("offers no model choice without a router, and a strict one with it", () => {
    const plain = buildSwarmFunctionTools("all", null);
    expect(laneEntryProperties(plain.find((tool) => tool.name === "split"))).not.toHaveProperty("model");

    const routed = buildSwarmFunctionTools("all", router);
    for (const name of ["split", "diverge"]) {
      const tool = routed.find((candidate) => candidate.name === name);
      const items = (tool?.parameters as { properties: { lanes: { items: { properties: object; required: string[] } } } }).properties.lanes.items;
      expect(items.required).toEqual(Object.keys(items.properties));
      expect((items.properties as Record<string, { enum: unknown[] }>).model.enum).toEqual(["strong", "other", null]);
    }
    expect(routed.find((tool) => tool.name === "check")?.parameters).toMatchObject({ required: expect.arrayContaining(["model", "effort"]) });
  });

  it("stores a pick from the router's targets, or nothing for the parent's own model", () => {
    expect(buildLaneModelRoute(router, null, null)).toBeNull();
    expect(buildLaneModelRoute(null, "strong", "high")).toBeNull();
    expect(buildLaneModelRoute(router, "other", "high")).toEqual({ routerId: "router", modelId: "other", reasoningScore: 62 });
    expect(() => buildLaneModelRoute(router, "unknown", null)).toThrow(SwarmToolError);
  });

  it("prefers a different model than the author's for the automatic Check", () => {
    expect(pickCheckModelRoute(router, "gpt-strong")?.modelId).toBe("other");
    expect(pickCheckModelRoute(null, "gpt-strong")).toBeNull();
  });

  it("runs a picked lane on the target's model and keeps a bring-your-own lane on its own", () => {
    const runtime = { model: "gpt-strong", payload: {}, provider: { kind: "platform" as const, baseUrl: "http://provider" } };
    const route = { routerId: "router", modelId: "other", reasoningScore: 50 };
    expect(applyLaneModelRoute(runtime, route, [router], {}).model).toBe("claude-other");
    expect(applyLaneModelRoute({ ...runtime, provider: { kind: "byo", baseUrl: "http://own" } }, route, [router], {}).model).toBe("gpt-strong");
    expect(applyLaneModelRoute(runtime, null, [router], {})).toBe(runtime);
  });

  it("drops the parent's reasoning items from a lane on a different model", () => {
    const seed = {
      items: [{ role: "user" as const, content: "Price it." }, { type: "reasoning", id: "rs", summary: [] }] as never,
      capabilities: { runtime: { model: "gpt-strong" } } as never
    };
    expect(inheritedItems(seed, "gpt-strong")).toHaveLength(2);
    expect(inheritedItems(seed, "claude-other")).toEqual([{ role: "user", content: "Price it." }]);
  });
});

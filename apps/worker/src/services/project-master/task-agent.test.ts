import { describe, expect, it } from "vitest";
import type { TaskMessageRow } from "../agent/types.js";
import { buildChosenModelRoute, pickProjectMasterTaskAgentId } from "./task-agent.js";

function userMessage(content: Record<string, unknown>): TaskMessageRow {
  return { role: "user", content_json: { text: "hi", ...content } } as unknown as TaskMessageRow;
}

const router = {
  id: "router-v1",
  routingModel: "gpt-router",
  defaultTargetModel: "fast",
  models: [
    { id: "deep", description: "Hard work.", model: "gpt-5.4", payload: {} },
    { id: "fast", description: "Quick work.", model: "gpt-5.4-mini", payload: {} }
  ]
};

describe("Project Master task agent", () => {
  it("keeps the last pick when later messages come from a chat app without one", () => {
    expect(pickProjectMasterTaskAgentId([userMessage({ taskAgent: { id: "Swarm" } }), userMessage({})])).toBe("swarm");
    expect(pickProjectMasterTaskAgentId([userMessage({ taskAgent: { id: "swarm" } }), userMessage({ taskAgent: { id: null } })])).toBeNull();
    expect(pickProjectMasterTaskAgentId([userMessage({})])).toBeNull();
  });

  it("turns the Master's router pick into a route and rejects models the router does not offer", () => {
    expect(buildChosenModelRoute(router, "deep", "low")).toEqual({ routerId: "router-v1", modelId: "deep", reasoningScore: 12 });
    expect(buildChosenModelRoute(null, "deep", "low")).toBeNull();
    expect(() => buildChosenModelRoute(router, "gpt-6", null)).toThrow(/deep, fast/);
  });
});

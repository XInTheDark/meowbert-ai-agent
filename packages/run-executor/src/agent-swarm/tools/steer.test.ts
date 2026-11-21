import { describe, expect, it, vi } from "vitest";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { buildSwarmFunctionTools } from "../../agent-tools/swarm.js";
import type { ToolDispatchContext } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import { handleSteer } from "./steer.js";

const LANE_ID = "11111111-1111-4111-8111-111111111111";

function setup() {
  const backend = { steerLane: vi.fn(async () => {}) } satisfies Partial<SwarmBackend>;
  const ctx = {
    taskId: "root",
    swarm: {
      run: { swarmTaskId: "root", settings: normalizeAgentSwarmSettings({}), lane: null }
    }
  } as unknown as ToolDispatchContext;
  return { backend, ctx };
}

const call = (args: object) => ({ name: "steer", arguments: JSON.stringify(args) }) as ResponseFunctionToolCall;

describe("steer tool urgent contract", () => {
  it("exposes strict nullable urgent boolean on steer", () => {
    const steer = buildSwarmFunctionTools("all").find((tool) => tool.name === "steer");
    if (!steer) throw new Error("steer tool missing");
    expect(steer.strict).toBe(true);
    const params = steer.parameters as Record<string, any>;
    expect(params.required.sort()).toEqual(["lane_id", "message", "urgent"]);
    expect(params.properties.urgent.type).toEqual(["boolean", "null"]);
  });

  it("defaults urgent to false and forwards urgent=true", async () => {
    const { backend, ctx } = setup();
    const normal = await handleSteer(backend as unknown as SwarmBackend, call({
      lane_id: LANE_ID, message: "Include unit tests.", urgent: null
    }), ctx);
    expect(normal).toMatchObject({ output: { steered: true, urgent: false } });
    expect(backend.steerLane).toHaveBeenCalledWith(expect.anything(), {
      laneTaskId: LANE_ID, message: "Include unit tests.", urgent: false
    });

    const urgent = await handleSteer(backend as unknown as SwarmBackend, call({
      lane_id: LANE_ID, message: "Abort training now.", urgent: true
    }), ctx);
    expect(urgent).toMatchObject({ output: { steered: true, urgent: true } });
    expect(backend.steerLane).toHaveBeenCalledWith(expect.anything(), {
      laneTaskId: LANE_ID, message: "Abort training now.", urgent: true
    });
  });
});

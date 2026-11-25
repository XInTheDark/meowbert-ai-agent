import { describe, expect, it, vi } from "vitest";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";
import type { ToolDispatchContext } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import type { SwarmLaneListing } from "../lane-types.js";
import { DIRECT_LIST_LANES_MAX_CHARS, handleListLanes } from "./list-lanes.js";

function lane(index: number, overrides: Partial<SwarmLaneListing> = {}): SwarmLaneListing {
  return {
    lane_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    parent_lane_id: null,
    title: `Lane ${index}`,
    kind: "split",
    status: "expired",
    resumable: false,
    steps: 4,
    spent_tokens: 1_500,
    direction: "d".repeat(350),
    summary: "s".repeat(900),
    files: [`lane-${index}/out.md`],
    ...overrides
  };
}

function call(): ResponseFunctionToolCall {
  return {
    type: "function_call",
    call_id: "call-list-lanes",
    name: "list_lanes",
    arguments: "{}"
  };
}

function context(codeModeParentCallId?: string): ToolDispatchContext {
  return {
    taskId: "leader-1",
    codeModeParentCallId,
    swarm: { run: { lane: null, settings: normalizeAgentSwarmSettings({ leaderAgentId: "leader" }) } }
  } as unknown as ToolDispatchContext;
}

describe("handleListLanes", () => {
  it("returns every lane when called inside exec so scripts can filter them", async () => {
    const lanes = Array.from({ length: 40 }, (_, index) => lane(index));
    const backend = { listLanes: vi.fn(async () => lanes) } as unknown as SwarmBackend;

    const result = await handleListLanes(backend, call(), context("exec-1"));

    expect(result.output).toEqual({ lanes });
  });

  it("caps direct calls within the output budget while keeping active, resumable, and recent lanes", async () => {
    const lanes = Array.from({ length: 40 }, (_, index) => lane(index));
    lanes[0] = lane(0, { status: "running", summary: null, files: [] });
    lanes[1] = lane(1, { status: "done", resumable: true });
    const backend = { listLanes: vi.fn(async () => lanes) } as unknown as SwarmBackend;

    const result = await handleListLanes(backend, call(), context());
    const output = result.output as {
      lanes: SwarmLaneListing[];
      total_lanes: number;
      omitted_lanes: number;
      truncated: boolean;
    };

    expect(output.truncated).toBe(true);
    expect(output.total_lanes).toBe(40);
    expect(output.omitted_lanes).toBe(40 - output.lanes.length);
    expect(JSON.stringify(output.lanes).length).toBeLessThanOrEqual(DIRECT_LIST_LANES_MAX_CHARS);
    expect(output.lanes.map((item) => item.lane_id)).toContain(lanes[0].lane_id);
    expect(output.lanes.map((item) => item.lane_id)).toContain(lanes[1].lane_id);
    expect(output.lanes.map((item) => item.lane_id)).toContain(lanes[39].lane_id);
  });
});

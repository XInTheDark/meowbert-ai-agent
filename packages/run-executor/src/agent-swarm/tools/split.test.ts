import { describe, expect, it, vi } from "vitest";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { createPromptEnvelope } from "../../agent/prompt-envelope.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../agent-tool-dispatch/types.js";
import { createSwarmActivity } from "../activity.js";
import type { SwarmBackend } from "../backend.js";
import { handleSplit } from "./split.js";

function setup() {
  const backend = {
    forkLanes: vi.fn(async (_run, input) => input.lanes.map((lane) => ({
      taskId: lane.taskId, label: lane.label, title: lane.title
    }))),
    emitEvent: vi.fn()
  } satisfies Partial<SwarmBackend>;
  const call: ResponseFunctionToolCall = {
    id: "item-1",
    type: "function_call",
    call_id: "call-split",
    name: "split",
    arguments: "{}"
  };
  const ctx = {
    taskId: "root",
    envRoot: "/project",
    assertNotCancelled: vi.fn(),
    swarm: {
      run: {
        swarmTaskId: "root",
        rootTaskPath: "tasks/root",
        settings: normalizeAgentSwarmSettings({}),
        router: null,
        lane: null,
        ancestorLaneIds: [],
        withinDiverge: false,
        forcedSubmitReason: null,
        budgetNoteSent: false,
        activity: createSwarmActivity()
      },
      runtime: { model: "test", provider: { kind: "platform", baseUrl: "https://provider" }, payload: {} },
      runToolOptions: { enabledSkills: [], enabledSources: [] },
      loadedToolGroups: [],
      turn: {
        envelope: createPromptEnvelope("test", []),
        responseTools: [],
        codeModeTools: [],
        requestItemCount: 0
      },
      compactForFork: vi.fn(async (items) => items)
    }
  } as unknown as ToolDispatchContext;
  const state = { conversationItems: [call], runPersistedItems: [], commandStep: 0 } as unknown as ToolDispatchState;
  return { backend, call, ctx, state };
}

describe("handleSplit wait option", () => {
  it.each([undefined, null, true])("parks by default when wait is %s", async (wait) => {
    const { backend, call, ctx, state } = setup();
    call.arguments = JSON.stringify({
      lanes: [{ title: "Research", direction: "Look into options.", weight: null }],
      spine_path: null,
      ...(wait !== undefined ? { wait } : {})
    });
    const result = await handleSplit(backend as unknown as SwarmBackend, call, ctx, state);
    expect(result).toMatchObject({ output: { waiting: true } });
    expect(state.swarmPark).toEqual({ reason: "lanes" });
  });

  it("keeps the caller running without parking when wait is false", async () => {
    const { backend, call, ctx, state } = setup();
    call.arguments = JSON.stringify({
      lanes: [{ title: "Research", direction: "Look into options.", weight: null }],
      spine_path: null,
      wait: false
    });
    const result = await handleSplit(backend as unknown as SwarmBackend, call, ctx, state);
    expect(result).toMatchObject({ output: { waiting: false } });
    expect(state.swarmPark).toBeUndefined();
    expect(backend.forkLanes).toHaveBeenCalledTimes(1);
  });
});

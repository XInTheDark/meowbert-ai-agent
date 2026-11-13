import { describe, expect, it, vi } from "vitest";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { ToolDispatchContext, ToolDispatchState } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import { createSwarmActivity } from "../activity.js";
import { handleCheck, interceptFinalResponseForCheck } from "./check.js";

function setup() {
  const backend = {
    loadCheckInputs: vi.fn(async () => ({ userMessages: ["Create a slide."], spinePath: null })),
    startCheckLane: vi.fn(async () => ({ taskId: "reviewer", label: "Check", title: "Check" })),
    emitEvent: vi.fn(), hasOwnLanes: vi.fn(async () => false), loadAutoCheckFiles: vi.fn(async () => [])
  } satisfies Partial<SwarmBackend>;
  const ctx = {
    taskId: "root", envRoot: "/project", assertNotCancelled: vi.fn(), getCurrentLeafMessageId: () => "leaf",
    swarm: {
      run: { swarmTaskId: "root", rootTaskPath: "tasks/root", settings: normalizeAgentSwarmSettings({}), router: null,
        lane: null, ancestorLaneIds: [], withinDiverge: false, forcedSubmitReason: null, budgetNoteSent: false, activity: createSwarmActivity() },
      runtime: { model: "test", provider: { kind: "platform", baseUrl: "https://provider" }, payload: {} },
      runToolOptions: { enabledSkills: [], enabledSources: [] }
    }
  } as unknown as ToolDispatchContext;
  return { backend, ctx, state: {} as ToolDispatchState };
}

const call = (name: string, args: object) => ({ name, arguments: JSON.stringify(args) }) as ResponseFunctionToolCall;

describe("Check review effort", () => {
  it.each([undefined, null, "standard", "thorough"])("starts the requested review for %s", async (review_effort) => {
    const { backend, ctx, state } = setup();
    await handleCheck(backend as unknown as SwarmBackend, call("check", { draft: "Draft", files: [], focus: null, review_effort }), ctx, state);
    expect(backend.startCheckLane).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reviewEffort: review_effort ?? "standard", focus: null
    }));
    expect(state.swarmPark).toEqual({ reason: "check" });
  });

  it("refuses invalid effort without creating a lane or parking the parent", async () => {
    const { backend, ctx, state } = setup();
    const reply = await handleCheck(backend as unknown as SwarmBackend, call("check", { draft: "Draft", files: [], focus: null, review_effort: "high" }), ctx, state);
    expect(reply).toHaveProperty("output.error");
    expect(backend.startCheckLane).not.toHaveBeenCalled();
    expect(state.swarmPark).toBeUndefined();
  });

  it("uses standard effort for automatic checks and leaves partial replies alone", async () => {
    const { backend, ctx, state } = setup();
    await expect(interceptFinalResponseForCheck(backend as unknown as SwarmBackend,
      call("final_response", { response: "Progress", partial: true }), ctx, state)).resolves.toBeNull();
    expect(backend.startCheckLane).not.toHaveBeenCalled();
    await interceptFinalResponseForCheck(backend as unknown as SwarmBackend, call("final_response", { response: "Draft" }), ctx, state);
    expect(backend.startCheckLane).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reviewEffort: "standard" }));
    expect(state.swarmPark).toEqual({ reason: "check" });
  });

  it("keeps leaf lanes from starting either review level", async () => {
    const { backend, ctx, state } = setup();
    ctx.swarm!.run.lane = { kind: "split", depth: 1 } as never;
    await handleCheck(backend as unknown as SwarmBackend, call("check", { draft: "Draft", files: [], focus: null, review_effort: "thorough" }), ctx, state);
    expect(backend.startCheckLane).not.toHaveBeenCalled();
  });
});

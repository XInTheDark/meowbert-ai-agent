import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";
import { createSwarmActivity } from "@meowbert/run-executor/agent-swarm/activity";
import { createHttpSwarmBackend } from "@meowbert/run-executor/run-api/http-swarm-backend";

vi.mock("../../lib/db.js", () => ({ query: vi.fn(async () => ({ rowCount: 1, rows: [] })) }));
vi.mock("../agent-swarm/park.js", () => ({ clearSwarmPark: vi.fn() }));
vi.mock("../agent-swarm/db-backend.js", () => ({
  dbSwarmBackend: { forkLanes: vi.fn(async (_run: unknown, input: { lanes: Array<{ taskId: string; label: string; title: string }> }) =>
    input.lanes.map(({ taskId, label, title }) => ({ taskId, label, title }))) }
}));

const { dbSwarmBackend } = await import("../agent-swarm/db-backend.js");
const { SWARM_CALL_HANDLERS } = await import("./swarm-calls.js");
const { clearSwarmPark } = await import("../agent-swarm/park.js");

const admittedRuntime = { model: "admitted-model", payload: {}, provider: { kind: "platform" as const, baseUrl: "https://platform" } };
const router = { id: "router", name: "Router", allowReasoningEffort: false, models: [{ id: "fast", model: "fast-model" }] };

function session(swarm: boolean) {
  return {
    runId: "run", taskId: "leader", holder: "device:d", leafMessageId: null,
    swarm: swarm ? {
      context: {
        swarmTaskId: "leader", rootTaskPath: "tasks/leader", settings: normalizeAgentSwarmSettings({ leaderAgentId: "leader" }),
        router, lane: null, ancestorLaneIds: [], withinDiverge: false, forcedSubmitReason: null, budgetNoteSent: false,
        activity: createSwarmActivity()
      },
      runtime: admittedRuntime,
      job: { taskId: "leader", runId: "run", workspaceId: "w", environmentId: "e" }
    } : null
  } as never;
}

function forkInput(route: unknown) {
  return {
    kind: "split",
    seed: { envelope: {}, tools: {}, items: [], capabilities: { runtime: { model: "chosen-by-device", payload: {}, provider: { kind: "byo", baseUrl: "x" } } } },
    crossModelSeed: null,
    lanes: [{ taskId: "11111111-1111-4111-8111-111111111111", label: "A", title: "Part", direction: null, weight: 1,
      modelRoute: route, brief: "Do A", forkOutput: {}, crossModel: false }]
  };
}

describe("swarm calls from a device", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads no swarm through the desktop backend for an ordinary local run", async () => {
    const backend = createHttpSwarmBackend({
      call: (method, args) => SWARM_CALL_HANDLERS[method as "swarm.load"](session(false), args),
      model: vi.fn()
    });
    await expect(backend.load({ workflow_type: null } as never, [])).resolves.toBeNull();
    expect(clearSwarmPark).not.toHaveBeenCalled();
  });

  it("loads the admitted swarm and takes over its park", async () => {
    const reply = await SWARM_CALL_HANDLERS["swarm.load"](session(true), []);
    expect(reply).toMatchObject({ ok: { swarmTaskId: "leader", lane: null } });
    expect(clearSwarmPark).toHaveBeenCalledWith("leader");
  });

  it("forks lanes on the runtime the server admitted, not the one the device sent", async () => {
    const reply = await SWARM_CALL_HANDLERS["swarm.forkLanes"](session(true), [forkInput({ routerId: "router", modelId: "fast", reasoningScore: 3 })]);
    expect(reply).toMatchObject({ ok: [{ label: "A" }] });
    const sent = vi.mocked(dbSwarmBackend.forkLanes).mock.calls.at(-1)![1];
    expect(sent.seed.capabilities.runtime).toEqual(admittedRuntime);
    expect(sent.lanes[0].modelRoute?.modelId).toBe("fast");
  });

  it("refuses lane models outside the swarm's router", async () => {
    const reply = await SWARM_CALL_HANDLERS["swarm.forkLanes"](session(true), [forkInput({ routerId: "router", modelId: "expensive", reasoningScore: 3 })]);
    expect(reply).toEqual({ refused: expect.stringContaining("router") });
  });

  it("rejects swarm calls from a run outside a swarm", async () => {
    await expect(SWARM_CALL_HANDLERS["swarm.forkLanes"](session(false), [forkInput(null)])).rejects.toThrow("not part of an Agent Swarm");
  });
});

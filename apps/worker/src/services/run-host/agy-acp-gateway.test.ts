import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeSession } from "@meowbert/run-executor/bridge/index";

type DriverBehavior = (session: BridgeSession) => void;

const mocks = vi.hoisted(() => ({
  behaviors: [] as Array<(session: unknown) => void>,
  hydrateCalls: 0
}));

vi.mock("../../lib/db.js", () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("../agent-swarm/budget.js", () => ({ chargeSwarmStep: vi.fn() }));
vi.mock("../agent-swarm/config.js", () => ({ loadSwarmRunContext: vi.fn(async () => null) }));
vi.mock("../tasks/platform-usage.js", () => ({ platformUsageRecorder: {} }));
vi.mock("../agy-acp/agy-profile-dir.js", () => ({
  hydrateSelectedAgyProfile: vi.fn(async () => {
    mocks.hydrateCalls += 1;
    return {};
  })
}));
vi.mock("../agy-acp/agy-bridge-host.js", () => {
  const sessions = new Map<string, unknown>();
  return {
    ensureWorkerBridgeHost: vi.fn(async () => ({
      registry: {
        register: ({ runId, session }: { runId: string; session: unknown }) => {
          sessions.set(runId, session);
          return { sessionCode: runId };
        },
        unregister: (runId: string) => sessions.delete(runId)
      }
    }))
  };
});
vi.mock("../agy-acp/agy-acp-driver.js", () => ({
  AgyAcpDriver: class {
    constructor(private readonly options: { bridgeSession: unknown }) {}
    getLatestContextUsage() { return null; }
    start() {
      const behavior = mocks.behaviors.shift();
      setTimeout(() => behavior?.(this.options.bridgeSession), 0);
      return Promise.resolve();
    }
    stop() { return Promise.resolve(); }
  }
}));

const { createAgyAwareModelGateway } = await import("./agy-acp-gateway.js");

const failSession: DriverBehavior = (session) => session.fail("Antigravity quota exhausted.");
const callTool: DriverBehavior = (session) => {
  void session.claimStart().then(() => session.invokeTool("read_file", { path: "a.txt" }));
};

function createGateway() {
  const run = {
    job: { runId: "run-1", taskId: "task-1" },
    bootstrap: { runtime: { modelType: "agy_acp", model: "gemini" } },
    snapshot: { platform_model_metadata: {} }
  };
  return createAgyAwareModelGateway({
    job: run.job as never,
    requireRun: () => run as never,
    directModels: { create: vi.fn() } as never,
    reportTurnUsageError: vi.fn(async () => undefined)
  });
}

function turnRequest() {
  return {
    purpose: "turn",
    body: { input: [{ role: "user", content: "hello" }], tools: [] }
  } as never;
}

describe("createAgyAwareModelGateway", () => {
  beforeEach(() => {
    mocks.behaviors.length = 0;
    mocks.hydrateCalls = 0;
  });

  it("replays the turn on a fresh ACP session when the current one fails", async () => {
    mocks.behaviors.push(failSession, callTool);
    const { models } = createGateway();

    const result = await models.create(turnRequest());

    expect(mocks.hydrateCalls).toBe(2);
    const output = (result.response as { output: Array<{ type: string; name?: string }> }).output;
    expect(output.some((item) => item.type === "function_call" && item.name === "read_file")).toBe(true);
  });

  it("gives up after repeated ACP session failures in one turn", async () => {
    mocks.behaviors.push(failSession, failSession, failSession);
    const { models } = createGateway();

    await expect(models.create(turnRequest())).rejects.toThrow(/quota exhausted/);
    expect(mocks.hydrateCalls).toBe(3);
  });
});

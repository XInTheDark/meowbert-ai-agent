import type { AddressInfo } from "node:net";
import type http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signRunLeaseToken } from "@meowbert/shared/run-lease-token";
import { createRunApiClient, RunApiError, type RunApiClient } from "@meowbert/run-executor/run-api/client";
import { createHttpRunControl } from "@meowbert/run-executor/run-api/http-run-control";
import { createProxyModelGateway } from "@meowbert/run-executor/run-api/proxy-model-gateway";
import type { ModelGateway } from "@meowbert/run-executor/agent/ports/model-gateway";
import { createFakeRunControl, type FakeRunControl } from "../run-host/test-run-environment.test-fixtures.js";
import { createRunApiHandler } from "./handler.js";
import { createRunApiServer } from "./server.js";
import { RunApiSessions, type RunApiSession, type RunModelPolicy } from "./sessions.js";
import { createMemoryRunApiStores } from "./memory-stores.test-fixtures.js";

const SECRET = "test-lease-secret";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

interface Harness {
  baseUrl: string;
  sessions: RunApiSessions;
  memory: ReturnType<typeof createMemoryRunApiStores>;
  chargeAbandoned: ReturnType<typeof vi.fn>;
  server: http.Server;
}

let harness: Harness;

function policy(overrides: Partial<RunModelPolicy> = {}): RunModelPolicy {
  return {
    billing: { userId: "user-1", taskId: "task-1", runId: RUN_ID },
    quotaExempt: false,
    model: () => "gpt-test",
    maxContextTokens: 10_000,
    modelPayload: { reasoning: { effort: "high" } },
    allowHostedWebSearch: false,
    ...overrides
  };
}

async function startHarness(headroomByUser?: Record<string, number>): Promise<Harness> {
  const memory = createMemoryRunApiStores({ headroomByUser });
  const sessions = new RunApiSessions();
  const chargeAbandoned = vi.fn(async () => {});
  const handler = createRunApiHandler({
    stores: memory.stores,
    sessions,
    leaseSecret: SECRET,
    // One weighted token per counted token keeps the arithmetic visible.
    model: { weighUsage: async (_model, counts) => counts.inputTokens + counts.outputTokens, chargeAbandoned }
  });
  const server = createRunApiServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, sessions, memory, chargeAbandoned, server };
}

async function claim(input: { runId?: string; control?: FakeRunControl; models?: ModelGateway; policy?: RunModelPolicy } = {}) {
  const runId = input.runId ?? RUN_ID;
  const { epoch } = (await harness.memory.stores.leases.claim({ runId, holder: "test", apiUrl: harness.baseUrl, ttlMs: 60_000 }))!;
  const control = input.control ?? createFakeRunControl();
  const session: RunApiSession = {
    runId,
    taskId: "task-1",
    epoch,
    holder: "test",
    control,
    models: input.models ?? { create: vi.fn(), isQuotaExceeded: vi.fn(async () => false) },
    policy: () => input.policy ?? policy(),
    leafMessageId: "leaf-0",
    lastEventSeq: 0,
    modelRequestInFlight: false,
    finishedAt: null
  };
  harness.sessions.add(session);
  return { session, control, token: signRunLeaseToken({ runId, taskId: "task-1", epoch, holder: "test" }, SECRET) };
}

// A network that delivers each request but loses the first response of every call matched.
function losingFirstResponse(match: (url: string) => boolean): typeof fetch {
  const lost = new Set<string>();
  return async (url, init) => {
    const response = await fetch(url, init);
    const key = `${String(url)}:${String(init?.body)}`;
    if (match(String(url)) && !lost.has(key)) {
      lost.add(key);
      throw new TypeError("fetch failed");
    }
    return response;
  };
}

function client(token: string, extra: Partial<Parameters<typeof createRunApiClient>[0]> = {}): RunApiClient {
  return createRunApiClient({ baseUrl: harness.baseUrl, runId: RUN_ID, token, retryDelaysMs: [1, 1, 1], ...extra });
}

beforeEach(async () => {
  harness = await startHarness({ "user-1": 1_000 });
});

afterEach(async () => {
  harness.server.closeAllConnections();
  await new Promise<void>((resolve) => harness.server.close(() => resolve()));
});

describe("Run API retries", () => {
  it("applies a message, an event, an artifact and a schedule once when their responses are lost", async () => {
    const { control, token } = await claim();
    control.platform.createRecurringTask.mockResolvedValue({ taskId: "scheduled-1" });
    const remote = createHttpRunControl(client(token, { fetch: losingFirstResponse(() => true) }));

    await expect(remote.appendMessage({ role: "assistant", content: { text: "hi" }, parentMessageId: "leaf-0" })).resolves.toBe("message-1");
    await remote.emitEvent("log", { message: "step" });
    await remote.platform.markArtifacts({ artifacts: [{ relativePath: "out.txt", size: 3 }] });
    await expect(remote.platform.createRecurringTask({ title: "Daily", message: "Report", repeat: "0 9 * * *", timezone: "UTC" } as never))
      .resolves.toEqual({ taskId: "scheduled-1" });

    expect(control.appendMessage).toHaveBeenCalledTimes(1);
    expect(control.emitEvent).toHaveBeenCalledTimes(1);
    expect(control.platform.markArtifacts).toHaveBeenCalledTimes(1);
    expect(control.platform.createRecurringTask).toHaveBeenCalledTimes(1);
  });

  it("reports a retry of an unfinished side effect as having an unknown outcome, never repeating it", async () => {
    const { control, token } = await claim();
    control.platform.createSubtask.mockReturnValue(new Promise(() => {}));
    const send = (body: object) => fetch(`${harness.baseUrl}/runs/${RUN_ID}/call/platform.createSubtask`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    // The first attempt never answers; the server is torn down under it.
    void send({ operationId: "op-1", args: [{ message: "x" }] }).catch(() => {});
    await vi.waitFor(() => expect(control.platform.createSubtask).toHaveBeenCalledTimes(1));

    const retry = await send({ operationId: "op-1", args: [{ message: "x" }] });
    const reused = await send({ operationId: "op-1", args: [{ message: "different" }] });

    expect((await retry.json()).error.code).toBe("outcome_unknown");
    expect((await reused.json()).error.code).toBe("operation_conflict");
    expect(control.platform.createSubtask).toHaveBeenCalledTimes(1);
  });

  it("drops a late duplicate event instead of publishing it out of order", async () => {
    const { control, token } = await claim();
    const remote = createHttpRunControl(client(token));
    await remote.emitEvent("log", { message: "first" });
    await remote.emitEvent("log", { message: "second" });
    await fetch(`${harness.baseUrl}/runs/${RUN_ID}/call/control.emitEvent`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ operationId: "replayed", args: ["log", { message: "first" }], seq: 1 })
    });

    expect(control.emitEvent.mock.calls.map((call) => (call[1] as { message: string }).message)).toEqual(["first", "second"]);
  });
});

describe("Run API branch and lease checks", () => {
  it("refuses an append to an outdated leaf and says where the branch is", async () => {
    const { control, token } = await claim();
    const remote = createHttpRunControl(client(token));
    await remote.appendMessage({ role: "assistant", content: { text: "one" }, parentMessageId: "leaf-0" });

    const error = await remote.appendMessage({ role: "assistant", content: { text: "fork" }, parentMessageId: "leaf-0" }).catch((caught) => caught);

    expect(error).toBeInstanceOf(RunApiError);
    expect(error).toMatchObject({ code: "leaf_moved", currentLeafId: "message-1" });
    expect(control.appendMessage).toHaveBeenCalledTimes(1);
  });

  it("accepts an append after messages the control plane added to the run's branch", async () => {
    const { control, token } = await claim();
    // Subagent mail lands between the run's own appends.
    harness.memory.messageParents.set("mail-1", "leaf-0");
    harness.memory.messageParents.set("mail-2", "mail-1");
    const remote = createHttpRunControl(client(token));

    await expect(remote.appendMessage({ role: "assistant", content: { text: "after mail" }, parentMessageId: "mail-2" })).resolves.toBe("message-1");
    expect(control.appendMessage).toHaveBeenCalledTimes(1);
  });

  it("gives a run to exactly one claim: the older epoch's token is refused", async () => {
    const first = await claim();
    const second = await claim();

    const stale = await client(first.token).call("control.setTaskStatus", ["running"]).catch((caught) => caught);
    await client(second.token).call("control.setTaskStatus", ["running"]);

    expect(stale).toMatchObject({ code: "lease_lost" });
    expect(first.control.setTaskStatus).not.toHaveBeenCalled();
    expect(second.control.setTaskStatus).toHaveBeenCalledTimes(1);
  });

  it("fences the executor once its lease is gone", async () => {
    const { token } = await claim();
    const onFenced = vi.fn();
    const remote = createHttpRunControl(client(token), { heartbeatIntervalMs: 5, onFenced });
    const watcher = vi.fn();
    remote.watchCancellation(watcher);
    await remote.bootstrap();

    harness.memory.leases.get(RUN_ID)!.epoch += 1;
    await vi.waitFor(() => expect(onFenced).toHaveBeenCalledTimes(1));

    expect(watcher).toHaveBeenCalledWith("newer_attempt");
    remote.stop();
  });

  it("fences itself when it cannot renew for longer than the fence delay", async () => {
    const { token } = await claim();
    const onFenced = vi.fn();
    const unreachable: typeof fetch = async (url, init) => {
      if (String(url).endsWith("control.heartbeat")) throw new TypeError("fetch failed");
      return fetch(url, init);
    };
    const remote = createHttpRunControl(client(token, { fetch: unreachable, retryDelaysMs: [] }), { heartbeatIntervalMs: 5, selfFenceAfterMs: 20, onFenced });
    await remote.bootstrap();

    await vi.waitFor(() => expect(onFenced).toHaveBeenCalledTimes(1));
    remote.stop();
  });
});

describe("Model proxy", () => {
  function modelReturning(response: object): ModelGateway {
    return { create: vi.fn(async () => ({ response: response as never, weightedTokens: 42 })), isQuotaExceeded: vi.fn(async () => false) };
  }

  it("rejects a request that picks the model, adds hosted tools or sends unknown fields", async () => {
    const models = modelReturning({ output: [] });
    const { token } = await claim({ models });
    const gateway = createProxyModelGateway(client(token));
    const send = (body: Record<string, unknown>) => gateway.create({ purpose: "turn", body, timeoutMs: 1_000 }).catch((caught) => caught);

    await expect(send({ model: "gpt-expensive", input: [] })).resolves.toMatchObject({ code: "invalid_request" });
    await expect(send({ input: [], tools: [{ type: "web_search" }] })).resolves.toMatchObject({ code: "invalid_request" });
    await expect(send({ input: [], service_tier: "priority" })).resolves.toMatchObject({ code: "invalid_request" });
    await expect(send({ input: [], reasoning: { effort: "xhigh" } })).resolves.toMatchObject({ code: "invalid_request" });
    expect(models.create).not.toHaveBeenCalled();

    await expect(send({ input: [], max_output_tokens: 100, reasoning: { effort: "high" }, tools: [{ type: "function", name: "run_shell" }] }))
      .resolves.toMatchObject({ weightedTokens: 42 });
  });

  it("keeps concurrent requests within the allowance", async () => {
    harness.server.close();
    harness = await startHarness({ "user-1": 2_500 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const models: ModelGateway = {
      create: vi.fn(async () => { await gate; return { response: { output: [] } as never, weightedTokens: 0 }; }),
      isQuotaExceeded: vi.fn(async () => false)
    };
    // Each request reserves its 1,000-token maximum output plus its input.
    const runs = await Promise.all(["a", "b", "c", "d"].map(async (suffix, index) => {
      const runId = `1111111${index}-1111-4111-8111-111111111111`;
      const claimed = await claim({ runId, models, policy: policy({ billing: { userId: "user-1", taskId: `task-${suffix}`, runId } }) });
      return createProxyModelGateway(createRunApiClient({ baseUrl: harness.baseUrl, runId, token: claimed.token }));
    }));

    const outcomes = runs.map((gateway) => gateway.create({ purpose: "turn", body: { input: [], max_output_tokens: 1_000 }, timeoutMs: 1_000 })
      .then(() => "ok", (error: RunApiError) => error.code));
    // Two requests are held upstream at once; only then do they finish.
    await vi.waitFor(() => expect(models.create).toHaveBeenCalledTimes(2));
    release();
    const results = await Promise.all(outcomes);

    expect(results.filter((result) => result === "ok")).toHaveLength(2);
    expect(results.filter((result) => result === "quota_exceeded")).toHaveLength(2);
    expect(harness.memory.reservations.size).toBe(0);
  });

  it("stops the upstream request and bills it once when the executor disconnects", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const models: ModelGateway = {
      create: vi.fn(async (request) => {
        upstreamSignal = request.signal;
        await new Promise((_resolve, reject) => request.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
        throw new Error("unreachable");
      }),
      isQuotaExceeded: vi.fn(async () => false)
    };
    const { token } = await claim({ models });
    const controller = new AbortController();
    const pending = createProxyModelGateway(client(token)).create({
      purpose: "turn", body: { input: [], max_output_tokens: 100 }, timeoutMs: 1_000, signal: controller.signal
    }).catch((caught) => caught);
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());

    controller.abort();
    await pending;

    await vi.waitFor(() => expect(upstreamSignal!.aborted).toBe(true));
    await vi.waitFor(() => expect(harness.chargeAbandoned).toHaveBeenCalledTimes(1));
    expect(harness.memory.reservations.size).toBe(0);
  });
});

it("refuses server workflow and host tools for a device lease without applying a side effect", async () => {
  const { session, control, token } = await claim();
  session.holder = "device:test";
  for (const method of ["platform.createSubtask", "platform.createRecurringTask", "platform.requestDesktopComputerAction"] as const) {
    await expect(client(token).call(method, [{}])).rejects.toMatchObject({ code: "invalid_request" });
  }
  expect(control.platform.createSubtask).not.toHaveBeenCalled();
  expect(control.platform.createRecurringTask).not.toHaveBeenCalled();
  expect(control.platform.requestDesktopComputerAction).not.toHaveBeenCalled();
});

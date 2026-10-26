import { expect, it, vi } from "vitest";
import type { RunApiModelRequest } from "@meowbert/shared";
import type { RunApiSession, RunModelPolicy } from "./sessions.js";
import { estimateMaximumUsage, proxyModelRequest } from "./model-proxy.js";
import { RunApiFailure } from "./failure.js";
import { createMemoryRunApiStores } from "./memory-stores.test-fixtures.js";

function fixture(validateTools: NonNullable<RunModelPolicy["validateTools"]> = async () => {}) {
  const policy: RunModelPolicy = { requestUserId: "user", billing: { userId: "user", taskId: "task", runId: "run" },
    quotaExempt: false, maxContextTokens: 10_000, model: () => "model", modelPayload: {}, allowHostedWebSearch: false, validateTools };
  const models = { create: vi.fn().mockResolvedValue({ response: { output: [] }, weightedTokens: 1 }) };
  const session = { runId: "run", policy: () => policy, models, control: { watchCancellation: () => () => {} }, modelRequestInFlight: false } as unknown as RunApiSession;
  const deps = { operations: createMemoryRunApiStores().stores.operations,
    reservations: { reserve: vi.fn().mockResolvedValue({ id: "reservation" }), release: vi.fn().mockResolvedValue(undefined) },
    weighUsage: async () => 100, chargeAbandoned: vi.fn().mockResolvedValue(undefined) };
  const request: RunApiModelRequest = { operationId: "op", purpose: "turn", body: { input: [], max_output_tokens: 100 }, timeoutMs: 1_000 };
  return { session, deps, request, policy, models };
}

it("holds the run lock during asynchronous tool discovery and releases it after forwarding", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const test = fixture(async () => gate);
  const pending = proxyModelRequest(test.session, test.request, test.deps, new AbortController().signal);
  try {
    await expect(proxyModelRequest(test.session, { ...test.request, operationId: "another" }, test.deps, new AbortController().signal))
      .rejects.toMatchObject({ code: "rate_limited" });
    finish(); await pending;
    expect(test.models.create).toHaveBeenCalledOnce();
    expect(test.session.modelRequestInFlight).toBe(false);
    expect(test.deps.reservations.release).toHaveBeenCalledOnce();
  } finally { finish(); await pending; }
});

it("never reserves or bills a request rejected at user admission", async () => {
  const test = fixture();
  const abort = new AbortController();
  await expect(proxyModelRequest(test.session, test.request, { ...test.deps, withUserSlot: async () => {
    throw new RunApiFailure("rate_limited", "Full");
  } }, abort.signal)).rejects.toMatchObject({ code: "rate_limited" });
  expect(test.models.create).not.toHaveBeenCalled();
  expect(test.deps.reservations.reserve).not.toHaveBeenCalled();
  expect(test.deps.chargeAbandoned).not.toHaveBeenCalled();
  expect(test.session.modelRequestInFlight).toBe(false);
});

it("never charges cancellation during tool validation as an abandoned provider request", async () => {
  const abort = new AbortController();
  const test = fixture(async () => { abort.abort(); });
  await expect(proxyModelRequest(test.session, test.request, test.deps, abort.signal)).rejects.toThrow();
  expect(test.models.create).not.toHaveBeenCalled();
  expect(test.deps.reservations.reserve).not.toHaveBeenCalled();
  expect(test.deps.chargeAbandoned).not.toHaveBeenCalled();
});

it("includes string input and tool definitions in the usage reservation estimate", () => {
  const { request, policy } = fixture();
  const baseline = estimateMaximumUsage(request, policy).inputTokens;
  const text = estimateMaximumUsage({ ...request, body: { ...request.body, input: "x".repeat(600) } }, policy).inputTokens;
  const tools = estimateMaximumUsage({ ...request, body: { ...request.body, tools: [{ type: "function", name: "tool", description: "x".repeat(600) }] } }, policy).inputTokens;
  expect(text).toBeGreaterThan(baseline); expect(tools).toBeGreaterThan(baseline);
});

it("rejoins a disconnected provider call without reserving or creating it twice", async () => {
  const test = fixture();
  let finish!: (result: { response: { output: never[] }; weightedTokens: number }) => void;
  test.models.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const disconnected = new AbortController();
  const first = proxyModelRequest(test.session, test.request, test.deps, disconnected.signal).catch((error) => error);
  await vi.waitFor(() => expect(test.models.create).toHaveBeenCalledOnce());
  disconnected.abort(new Error("Disconnected"));
  await expect(first).resolves.toMatchObject({ message: "Disconnected" });
  const replay = proxyModelRequest(test.session, test.request, test.deps, new AbortController().signal);
  const result = { response: { output: [] as never[] }, weightedTokens: 7 };
  finish(result);
  await expect(replay).resolves.toEqual(result);
  expect(test.models.create).toHaveBeenCalledOnce();
  expect(test.deps.reservations.reserve).toHaveBeenCalledOnce();
  expect(test.deps.reservations.release).toHaveBeenCalledOnce();
  expect(test.deps.chargeAbandoned).not.toHaveBeenCalled();
});

it("returns durable results for an older operation after another request completed", async () => {
  const test = fixture();
  const signal = new AbortController().signal;
  const first = await proxyModelRequest(test.session, test.request, test.deps, signal);
  await proxyModelRequest(test.session, { ...test.request, operationId: "next" }, test.deps, signal);
  await expect(proxyModelRequest(test.session, test.request, test.deps, signal)).resolves.toEqual(first);
  expect(test.models.create).toHaveBeenCalledTimes(2);
  expect(test.deps.reservations.reserve).toHaveBeenCalledTimes(2);
});

it("rejects a reused operation id with different input without forwarding it", async () => {
  const test = fixture();
  const signal = new AbortController().signal;
  await proxyModelRequest(test.session, test.request, test.deps, signal);
  await expect(proxyModelRequest(test.session, { ...test.request, body: { input: "different" } }, test.deps, signal))
    .rejects.toMatchObject({ code: "operation_conflict" });
  expect(test.models.create).toHaveBeenCalledOnce();
});

it("refuses to repeat pending provider work after its worker session was lost", async () => {
  const test = fixture();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  test.models.create.mockImplementationOnce(async () => { await gate; return { response: { output: [] }, weightedTokens: 1 }; });
  const pending = proxyModelRequest(test.session, test.request, test.deps, new AbortController().signal);
  try {
    await vi.waitFor(() => expect(test.models.create).toHaveBeenCalledOnce());
    const replacement = { ...test.session, modelRequestInFlight: false };
    await expect(proxyModelRequest(replacement, test.request, test.deps, new AbortController().signal))
      .rejects.toMatchObject({ code: "outcome_unknown" });
    expect(test.models.create).toHaveBeenCalledOnce();
  } finally { finish(); await pending; }
});

it("cancels and bills abandoned provider work once after the reconnect grace expires", async () => {
  vi.useFakeTimers();
  const test = fixture();
  test.request.timeoutMs = 60_000;
  let upstreamSignal!: AbortSignal;
  test.models.create.mockImplementationOnce(({ signal }) => {
    upstreamSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  });
  const disconnected = new AbortController();
  const pending = proxyModelRequest(test.session, test.request, test.deps, disconnected.signal).catch((error) => error);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(test.models.create).toHaveBeenCalledOnce();
    disconnected.abort();
    await pending;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(upstreamSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(upstreamSignal.aborted).toBe(true);
    expect(test.session.modelRequestInFlight).toBe(false);
    expect(test.deps.chargeAbandoned).toHaveBeenCalledOnce();
    expect(test.deps.reservations.release).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it("aborts immediately on server cancellation instead of waiting for reconnect grace", async () => {
  const test = fixture();
  let notify!: (reason: "explicit_cancel" | "newer_attempt") => void;
  const stopWatching = vi.fn();
  test.session.control.watchCancellation = (callback) => { notify = callback; return stopWatching; };
  test.models.create.mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  }));
  const pending = proxyModelRequest(test.session, test.request, test.deps, new AbortController().signal);
  const outcome = expect(pending).rejects.toThrow("TASK_CANCELLED");
  await vi.waitFor(() => expect(test.models.create).toHaveBeenCalledOnce());
  notify("explicit_cancel");
  await outcome;
  expect(test.deps.chargeAbandoned).toHaveBeenCalledOnce();
  expect(test.deps.reservations.release).toHaveBeenCalledOnce();
  expect(stopWatching).toHaveBeenCalledOnce();
});

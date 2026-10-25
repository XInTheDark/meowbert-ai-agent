import { expect, it, vi } from "vitest";
import type { RunApiModelRequest } from "@meowbert/shared";
import type { RunApiSession, RunModelPolicy } from "./sessions.js";
import { estimateMaximumUsage, proxyModelRequest } from "./model-proxy.js";
import { RunApiFailure } from "./failure.js";

function fixture(validateTools: NonNullable<RunModelPolicy["validateTools"]> = async () => {}) {
  const policy: RunModelPolicy = { requestUserId: "user", billing: { userId: "user", taskId: "task", runId: "run" },
    quotaExempt: false, maxContextTokens: 10_000, model: () => "model", modelPayload: {}, allowHostedWebSearch: false, validateTools };
  const models = { create: vi.fn().mockResolvedValue({ response: { output: [] }, weightedTokens: 1 }) };
  const session = { runId: "run", policy: () => policy, models, modelRequestInFlight: false } as unknown as RunApiSession;
  const deps = { reservations: { reserve: vi.fn().mockResolvedValue({ id: "reservation" }), release: vi.fn().mockResolvedValue(undefined) },
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
      .rejects.toMatchObject({ code: "invalid_request" });
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
    abort.abort(); throw new RunApiFailure("rate_limited", "Full");
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

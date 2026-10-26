import { afterEach, expect, it, vi } from "vitest";
import { createModelResponseWithRetry } from "./model.js";
import type { ModelGateway } from "./ports/model-gateway.js";
import type { RunControl } from "./ports/run-control.js";

const response = { response: { output: [], error: null } as never, weightedTokens: null };

function fixture() {
  const models = { create: vi.fn().mockResolvedValue(response), isQuotaExceeded: vi.fn() } satisfies ModelGateway;
  const control = { emitEvent: vi.fn().mockResolvedValue(undefined) } as unknown as RunControl;
  const input = {
    models, chatGptCodex: false, prefixItems: [],
    conversationItems: [{ role: "user" as const, content: "Keep this request" }],
    modelPayload: {}, tools: [], promptCacheKey: "task-cache", sessionAffinityKey: "lane-session",
    onConsecutiveErrorRecovery: vi.fn().mockResolvedValue(true)
  };
  return { models, control, input };
}

afterEach(() => vi.useRealTimers());

it.each([
  "terminated",
  "read tcp 10.0.1.12:52142->172.67.131.66:443: read: connection reset by peer",
  "Another model request for this run is in flight.",
  "429 Too many requests",
  "502 Bad gateway"
])("keeps conversation history intact after repeated %s failures", async (message) => {
  vi.useFakeTimers();
  const { models, control, input } = fixture();
  models.create.mockRejectedValueOnce(new Error(message)).mockRejectedValueOnce(new Error(message))
    .mockRejectedValueOnce(new Error(message));
  const original = structuredClone(input.conversationItems);
  const pending = createModelResponseWithRetry(control, "task", input);
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toEqual(response);
  expect(models.create).toHaveBeenCalledTimes(4);
  expect(input.onConsecutiveErrorRecovery).not.toHaveBeenCalled();
  expect(input.conversationItems).toEqual(original);
  expect(models.create.mock.calls.map(([request]) => request.body.input)).toEqual(Array(4).fill(original));
});

it("replaces a conflicting session for retries and later turns while retaining history and the cache key", async () => {
  vi.useFakeTimers();
  const { models, control, input } = fixture();
  models.create.mockRejectedValueOnce(new Error("400 This session advanced while the request was waiting. Retry with the latest conversation history or use a distinct session ID."));
  const pending = createModelResponseWithRetry(control, "task", input);
  await vi.runAllTimersAsync();
  await pending;
  await createModelResponseWithRetry(control, "task", input);
  const requests = models.create.mock.calls.map(([request]) => request);
  expect(requests[0].sessionId).toBe("task");
  expect(requests[1].sessionId).not.toBe(requests[0].sessionId);
  expect(requests[1].headers!["x-session-affinity"]).not.toBe("lane-session");
  expect(requests[2].sessionId).toBe(requests[1].sessionId);
  expect(requests[2].headers).toEqual(requests[1].headers);
  expect(requests.map((request) => request.body.input)).toEqual(Array(3).fill(input.conversationItems));
  expect(requests.map((request) => request.body.prompt_cache_key)).toEqual(Array(3).fill("task-cache"));
  expect(input.onConsecutiveErrorRecovery).not.toHaveBeenCalled();
});

it.each(["400 invalid image", "400 No tool output found for function call call_missing."])("bounds attempts even when input repair repeatedly succeeds for %s", async (message) => {
  vi.useFakeTimers();
  const { models, control, input } = fixture();
  models.create.mockRejectedValue(new Error(message));
  const outcome = expect(createModelResponseWithRetry(control, "task", input)).rejects.toThrow(message);
  await vi.runAllTimersAsync();
  await outcome;
  expect(models.create).toHaveBeenCalledTimes(6);
});

it.each(["lease_lost", "outcome_unknown", "operation_conflict", "unauthorized", "quota_exceeded"])("does not issue fresh provider work after %s", async (code) => {
  const { models, control, input } = fixture();
  models.create.mockRejectedValue(Object.assign(new Error("Request cannot safely continue"), { code }));
  await expect(createModelResponseWithRetry(control, "task", input)).rejects.toMatchObject({ code });
  expect(models.create).toHaveBeenCalledOnce();
  expect(input.onConsecutiveErrorRecovery).not.toHaveBeenCalled();
});

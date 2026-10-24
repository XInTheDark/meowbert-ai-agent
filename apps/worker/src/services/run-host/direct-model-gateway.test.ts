import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@meowbert/run-executor/agent/openai-client", () => ({
  getOpenAiClient: vi.fn()
}));

vi.mock("../tasks/platform-usage.js", () => ({
  platformUsageRecorder: {
    computeCost: vi.fn(async () => ({ resolvedModel: "gpt-test", weightedTokens: 77 })),
    recordEvent: vi.fn(async () => {})
  }
}));

vi.mock("../tasks/subscription-usage.js", () => ({
  getUserMonthlySubscriptionQuotaStatus: vi.fn()
}));

import { getOpenAiClient } from "@meowbert/run-executor/agent/openai-client";
import { platformUsageRecorder } from "../tasks/platform-usage.js";
import { getUserMonthlySubscriptionQuotaStatus } from "../tasks/subscription-usage.js";
import { createDirectModelGateway } from "./direct-model-gateway.js";
import { createTestServerRunState, type TestRunInput } from "./test-run-environment.test-fixtures.js";

function respondWith(response: Record<string, unknown>) {
  const create = vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "response.completed", response: { error: null, output: [], output_text: "", ...response } };
    }
  }));
  vi.mocked(getOpenAiClient).mockReturnValue({ responses: { create } } as never);
  return create;
}

function gatewayFor(input: TestRunInput, reportTurnUsageError = vi.fn(async () => {})) {
  const state = createTestServerRunState(input);
  return createDirectModelGateway({ requireRun: () => state, reportTurnUsageError });
}

const billing = { userId: "user-1", taskId: "task-1", runId: "run-1" };

describe("createDirectModelGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bills each response to the run that made it and returns its weighted cost", async () => {
    respondWith({ usage: { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 20 } } });
    const gateway = gatewayFor({ billing });

    const result = await gateway.create({ purpose: "turn", body: { input: [] }, timeoutMs: 1000 });

    expect(result.weightedTokens).toBe(77);
    expect(platformUsageRecorder.recordEvent).toHaveBeenCalledWith(
      billing,
      expect.objectContaining({ inputTokens: 120, cachedInputTokens: 20, outputTokens: 30 }),
      expect.objectContaining({ weightedTokens: 77 })
    );
  });

  it("uses the run's model for turns and its quick model for titles, whatever the request says", async () => {
    const create = respondWith({});
    const gateway = gatewayFor({ model: "gpt-main", quickModel: "gpt-quick" });

    await gateway.create({ purpose: "turn", body: { model: "other" }, timeoutMs: 1000 });
    await gateway.create({ purpose: "title", body: { model: "other" }, timeoutMs: 1000 });

    expect(create.mock.calls.map((call) => (call as unknown as [{ model: string }])[0].model)).toEqual(["gpt-main", "gpt-quick"]);
  });

  it("reports a failure to bill an agent turn without failing the turn", async () => {
    respondWith({ usage: { input_tokens: 1, output_tokens: 1 } });
    vi.mocked(platformUsageRecorder.recordEvent).mockRejectedValueOnce(new Error("db down"));
    const reportTurnUsageError = vi.fn(async () => {});
    const gateway = gatewayFor({ billing }, reportTurnUsageError);

    const result = await gateway.create({ purpose: "turn", body: {}, timeoutMs: 1000 });

    expect(result.weightedTokens).toBeNull();
    expect(reportTurnUsageError).toHaveBeenCalledWith("Failed to record token usage event: db down");
  });

  it("enforces the monthly quota only for billed, non-exempt runs", async () => {
    vi.mocked(getUserMonthlySubscriptionQuotaStatus).mockResolvedValue({ used: 10, limit: 5, exceeded: true } as never);

    await expect(gatewayFor({ billing }).isQuotaExceeded()).resolves.toBe(true);
    await expect(gatewayFor({ billing, quotaExempt: true }).isQuotaExceeded()).resolves.toBe(false);
    await expect(gatewayFor({}).isQuotaExceeded()).resolves.toBe(false);
    expect(getUserMonthlySubscriptionQuotaStatus).toHaveBeenCalledTimes(1);
  });

  it("does not enforce a quota for a user without a plan", async () => {
    vi.mocked(getUserMonthlySubscriptionQuotaStatus).mockResolvedValue({ used: 10, limit: 0, exceeded: true } as never);

    await expect(gatewayFor({ billing }).isQuotaExceeded()).resolves.toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./store.js", () => ({
  claimDueActivations: vi.fn(), expireActivationClaims: vi.fn(), finishActivation: vi.fn(), getActivationProvider: vi.fn()
}));
vi.mock("./request.js", () => ({ sendActivationRequest: vi.fn(), activationErrorMessage: () => "Safe error" }));
import * as store from "./store.js";
import { sendActivationRequest } from "./request.js";
import { processDueActivations, startUsageActivationLoop } from "./service.js";
const claim = { id: "schedule", token: "token", revision: 1, model: "model-a" };
const provider = { baseUrl: "https://provider.test/v1", apiKey: "secret" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(store.claimDueActivations).mockResolvedValue([claim]);
  vi.mocked(store.getActivationProvider).mockResolvedValue(provider);
});
afterEach(() => { vi.useRealTimers(); });
describe("scheduled activation worker", () => {
  it("sends a claimed request and persists its outcome", async () => {
    await processDueActivations();
    expect(sendActivationRequest).toHaveBeenCalledExactlyOnceWith(provider, "model-a");
    expect(store.finishActivation).toHaveBeenCalledWith(claim, "succeeded", null);
  });
  it("skips disabled, edited, deleted or expired claims without calling the provider", async () => {
    vi.mocked(store.getActivationProvider).mockResolvedValue(null);
    await processDueActivations();
    expect(sendActivationRequest).not.toHaveBeenCalled();
    expect(store.finishActivation).toHaveBeenCalledWith(claim, "skipped", expect.any(String));
  });
  it("records failures without retries and continues other scheduled requests", async () => {
    vi.mocked(store.claimDueActivations).mockResolvedValue([claim, { ...claim, id: "second" }]);
    vi.mocked(sendActivationRequest).mockRejectedValueOnce(new Error("secret provider body"));
    await processDueActivations();
    expect(sendActivationRequest).toHaveBeenCalledTimes(2);
    expect(store.finishActivation).toHaveBeenCalledWith(claim, "failed", "Safe error");
    expect(store.finishActivation).toHaveBeenCalledWith({ ...claim, id: "second" }, "succeeded", null);
  });
  it("stops polling and waits for in-flight work on shutdown", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    vi.mocked(sendActivationRequest).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const loop = startUsageActivationLoop();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.claimDueActivations).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = loop.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await stopping;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.claimDueActivations).toHaveBeenCalledTimes(1);
  });
});

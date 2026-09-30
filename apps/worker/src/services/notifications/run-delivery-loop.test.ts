import { expect, it, vi } from "vitest";
vi.mock("./run-delivery.js", () => ({deliverPendingRuns: vi.fn().mockResolvedValue(0)}));
import { deliverPendingRuns } from "./run-delivery.js";
import { startRunDeliveryLoop, wakeRunDeliveryLoop } from "./run-delivery-loop.js";

it("recovers on startup, wakes on completion, and stops polling on shutdown", async () => {
  vi.useFakeTimers();
  const loop = startRunDeliveryLoop();
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(deliverPendingRuns).toHaveBeenCalledTimes(1);
    wakeRunDeliveryLoop();
    await vi.advanceTimersByTimeAsync(1);
    expect(deliverPendingRuns).toHaveBeenCalledTimes(2);
    await loop.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deliverPendingRuns).toHaveBeenCalledTimes(2);
  } finally { await loop.stop(); vi.useRealTimers(); }
});

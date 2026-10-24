import { afterEach, expect, it, vi } from "vitest";
import { createRunLeaseKeeper } from "./lease-keeper.js";
afterEach(() => vi.useRealTimers());
it("fences once on the independent deadline even when a heartbeat never settles", async () => {
  vi.useFakeTimers();
  const call = vi.fn(() => new Promise<never>(() => {}));
  const onFenced = vi.fn();
  const watcher = vi.fn();
  const lease = createRunLeaseKeeper({ call, model: vi.fn() }, { heartbeatIntervalMs: 10, selfFenceAfterMs: 30, onFenced });
  lease.watch(watcher);
  lease.start();
  await vi.advanceTimersByTimeAsync(100);
  expect(onFenced).toHaveBeenCalledTimes(1);
  expect(watcher).toHaveBeenCalledWith("newer_attempt");
  expect(call).toHaveBeenCalledTimes(1);
  lease.stop();
});
it("stopping a healthy lease cancels its fencing deadline", async () => {
  vi.useFakeTimers();
  const onFenced = vi.fn();
  const lease = createRunLeaseKeeper({ call: vi.fn().mockResolvedValue({}), model: vi.fn() }, { heartbeatIntervalMs: 10, selfFenceAfterMs: 30, onFenced });
  lease.start(); lease.stop();
  await vi.advanceTimersByTimeAsync(100);
  expect(onFenced).not.toHaveBeenCalled();
});

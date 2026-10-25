import { afterEach, expect, it, vi } from "vitest";
import { DeviceTaskLock } from "./device-task-lock";
afterEach(() => vi.useRealTimers());
it("arbitrates between tasks and releases after inactivity", async () => {
  vi.useFakeTimers();
  const lock = new DeviceTaskLock("Computer Use", 90_000);
  await lock.use("first", async () => {});
  expect(() => lock.acquire("second")).toThrow("Computer Use is in use by first");
  await vi.advanceTimersByTimeAsync(90_000);
  expect(() => lock.acquire("second")).not.toThrow();
  lock.release("first");
  expect(() => lock.acquire("third")).toThrow("second");
  lock.release("second");
  expect(() => lock.acquire("third")).not.toThrow();
});
it("does not expire ownership while an action is running", async () => {
  vi.useFakeTimers();
  const lock = new DeviceTaskLock("The browser", 300_000);
  let finish!: () => void;
  const action = lock.use("first", () => new Promise<void>((resolve) => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(600_000);
  expect(() => lock.acquire("second")).toThrow("first");
  finish(); await action;
  lock.release("first");
});

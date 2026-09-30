import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
import { query } from "../../lib/db.js";
import { watchRunCancellation } from "./cancellation-batch.js";
const stops: Array<() => void> = [];
afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.useRealTimers(); vi.resetAllMocks(); });

it("checks 100 active runs with one query per interval and stops when idle", async () => {
  vi.useFakeTimers();
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, task_id: `t${i}`, cancellation_requested: false, is_latest: true }));
  vi.mocked(query).mockResolvedValue({ rows } as never);
  for (const row of rows) stops.push(watchRunCancellation(row.task_id, row.id, vi.fn()));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(query).toHaveBeenCalledTimes(120);
  stops.splice(0).forEach((stop) => stop());
  await vi.advanceTimersByTimeAsync(5_000);
  expect(query).toHaveBeenCalledTimes(120);
});

it("distinguishes cancellation from supersession and ignores unsubscribed in-flight watches", async () => {
  vi.useFakeTimers();
  const cancelled = vi.fn(); const superseded = vi.fn(); const removed = vi.fn();
  stops.push(watchRunCancellation("t1", "r1", cancelled), watchRunCancellation("t2", "r2", superseded));
  const stop = watchRunCancellation("t3", "r3", removed);
  stops.push(stop);
  vi.mocked(query).mockImplementation(async () => {
    stop();
    return { rows: [{id: "r1", task_id: "t1", cancellation_requested: true, is_latest: true}] } as never;
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(cancelled).toHaveBeenCalledWith("explicit_cancel");
  expect(superseded).toHaveBeenCalledWith("newer_attempt");
  expect(removed).not.toHaveBeenCalled();
});

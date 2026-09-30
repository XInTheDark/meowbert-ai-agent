import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceTaskEventCursor,
  compareTaskEventCursors,
  createCoalescedRefreshController,
  getNewestTaskEventCursor,
  shouldRefreshTaskSnapshotForEventType
} from "./taskDetailEventSync";

function createDeferredPromise(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return {
    promise,
    resolve: () => {
      resolve?.();
    }
  };
}

describe("taskDetailEventSync", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("orders event cursors by createdAt and id", () => {
    expect(compareTaskEventCursors(
      { createdAt: "2026-03-10T10:00:00.000Z", id: "a" },
      { createdAt: "2026-03-10T10:00:01.000Z", id: "a" }
    )).toBeLessThan(0);

    expect(compareTaskEventCursors(
      { createdAt: "2026-03-10T10:00:00.000Z", id: "a" },
      { createdAt: "2026-03-10T10:00:00.000Z", id: "b" }
    )).toBeLessThan(0);
  });

  it("advances the cursor without moving backwards", () => {
    const current = { createdAt: "2026-03-10T10:00:01.000Z", id: "b" };

    expect(advanceTaskEventCursor(current, {
      createdAt: "2026-03-10T10:00:00.000Z",
      id: "z"
    })).toEqual(current);

    expect(advanceTaskEventCursor(current, {
      createdAt: "2026-03-10T10:00:02.000Z",
      id: "a"
    })).toEqual({
      createdAt: "2026-03-10T10:00:02.000Z",
      id: "a"
    });
  });

  it("finds the newest cursor in an event batch", () => {
    expect(getNewestTaskEventCursor([
      { createdAt: "2026-03-10T10:00:00.000Z", id: "a" },
      { createdAt: "2026-03-10T10:00:02.000Z", id: "a" },
      { createdAt: "2026-03-10T10:00:01.000Z", id: "z" }
    ])).toEqual({
      createdAt: "2026-03-10T10:00:02.000Z",
      id: "a"
    });
  });

  it("refreshes task snapshots only for metadata-changing event types", () => {
    expect(shouldRefreshTaskSnapshotForEventType("status")).toBe(true);
    expect(shouldRefreshTaskSnapshotForEventType("error")).toBe(true);
    expect(shouldRefreshTaskSnapshotForEventType("notification")).toBe(true);

    expect(shouldRefreshTaskSnapshotForEventType("log")).toBe(false);
    expect(shouldRefreshTaskSnapshotForEventType("command_start")).toBe(false);
    expect(shouldRefreshTaskSnapshotForEventType("command_end")).toBe(true);
    expect(shouldRefreshTaskSnapshotForEventType("context_usage")).toBe(false);
    expect(shouldRefreshTaskSnapshotForEventType("artifact")).toBe(false);
  });

  it("coalesces repeated refresh schedules into one run", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const controller = createCoalescedRefreshController(run, 100);

    controller.schedule();
    controller.schedule();
    controller.schedule();

    await vi.advanceTimersByTimeAsync(100);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs one more refresh when rescheduled mid-flight", async () => {
    vi.useFakeTimers();
    const firstRun = createDeferredPromise();
    const run = vi.fn()
      .mockImplementationOnce(() => firstRun.promise)
      .mockResolvedValueOnce(undefined);
    const controller = createCoalescedRefreshController(run, 100);

    controller.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);

    controller.schedule();
    controller.schedule();

    firstRun.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);

    expect(run).toHaveBeenCalledTimes(2);
  });
});

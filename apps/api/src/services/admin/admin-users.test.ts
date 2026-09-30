import { describe, expect, it } from "vitest";
import { buildUsageAdjustmentEvents, type UsageAdjustmentWindow } from "./admin-usage-adjustments.js";

function sumWindow(events: Array<{ occurredAtUtc: string; delta: number }>, window: UsageAdjustmentWindow): number {
  const startMs = new Date(window.startUtc).getTime();
  const endMs = new Date(window.endUtc).getTime();
  return events.reduce((sum, event) => {
    const eventMs = new Date(event.occurredAtUtc).getTime();
    return eventMs >= startMs && eventMs < endMs ? sum + event.delta : sum;
  }, window.currentUsage);
}

describe("admin user usage adjustments", () => {
  it("targets each active usage window with isolated adjustment events", () => {
    const referenceDate = new Date("2026-05-13T12:00:00.000Z");
    const windows: UsageAdjustmentWindow[] = [
      {
        startUtc: "2026-05-06T12:00:00.000Z",
        endUtc: referenceDate.toISOString(),
        currentUsage: 40
      },
      {
        startUtc: "2026-05-01T00:00:00.000Z",
        endUtc: referenceDate.toISOString(),
        currentUsage: 70
      },
      {
        startUtc: "2026-04-13T12:00:00.000Z",
        endUtc: referenceDate.toISOString(),
        currentUsage: 120
      }
    ];

    const events = buildUsageAdjustmentEvents({
      windows,
      targetUsage: 100,
      referenceDate
    });

    expect(events).toEqual([
      { occurredAtUtc: "2026-05-13T11:59:59.999Z", delta: 60 },
      { occurredAtUtc: "2026-05-06T11:59:59.999Z", delta: -30 },
      { occurredAtUtc: "2026-04-30T23:59:59.999Z", delta: -50 }
    ]);
    for (const window of windows) {
      expect(sumWindow(events, window)).toBe(100);
    }
  });

  it("deduplicates identical windows before planning adjustments", () => {
    const referenceDate = new Date("2026-05-13T12:00:00.000Z");
    const window = {
      startUtc: "2026-05-06T12:00:00.000Z",
      endUtc: referenceDate.toISOString(),
      currentUsage: 25
    };

    const events = buildUsageAdjustmentEvents({
      windows: [window, window],
      targetUsage: 40,
      referenceDate
    });

    expect(events).toEqual([{ occurredAtUtc: "2026-05-13T11:59:59.999Z", delta: 15 }]);
  });
});

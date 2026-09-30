import { describe, expect, it } from "vitest";
import { nextUsageActivationAt, usageActivationInputSchema, type UsageActivationRule } from "./usage-activation.js";

const daily: UsageActivationRule = { kind: "at", days: [0, 1, 2, 3, 4, 5, 6], time: "03:00" };
const interval: UsageActivationRule = { kind: "interval", days: [1, 2, 3, 4, 5], everyMinutes: 30,
  windows: [{ start: "08:15", end: "10:00" }, { start: "18:00", end: "20:00" }] };
const next = (rules: UsageActivationRule[], time: string) => nextUsageActivationAt(rules, new Date(time)).toISOString();
const input = { name: "Morning", providerId: "11111111-1111-4111-8111-111111111111", model: "model-a", enabled: false, rules: [daily] };

describe("UTC activation scheduling", () => {
  it("runs daily at 03:00 UTC and moves strictly past an existing occurrence", () => {
    expect(next([daily], "2026-09-29T02:59:59Z")).toBe("2026-09-29T03:00:00.000Z");
    expect(next([daily], "2026-09-29T03:00:00Z")).toBe("2026-09-30T03:00:00.000Z");
    expect(next([daily], "2026-09-29T10:59:59+08:00")).toBe("2026-09-29T03:00:00.000Z");
  });
  it("anchors intervals to each window, excludes the end and skips weekends", () => {
    expect(next([interval], "2026-09-29T08:15:00Z")).toBe("2026-09-29T08:45:00.000Z");
    expect(next([interval], "2026-09-29T09:45:00Z")).toBe("2026-09-29T18:00:00.000Z");
    expect(next([interval], "2026-10-02T19:30:00Z")).toBe("2026-10-05T08:15:00.000Z");
  });
  it("supports different weekend rules and coalesces overlapping occurrences", () => {
    const weekend: UsageActivationRule = { kind: "at", days: [0, 6], time: "12:00" };
    expect(next([interval, weekend], "2026-10-02T19:30:00Z")).toBe("2026-10-03T12:00:00.000Z");
    expect(next([daily, daily], "2026-09-29T03:00:00Z")).toBe("2026-09-30T03:00:00.000Z");
  });
  it("keeps overnight occurrences attached to the start weekday across week boundaries", () => {
    const overnight: UsageActivationRule = { kind: "interval", days: [0], everyMinutes: 60, windows: [{ start: "22:00", end: "02:00" }] };
    expect(next([overnight], "2026-10-05T00:15:00Z")).toBe("2026-10-05T01:00:00.000Z");
    expect(next([overnight], "2026-10-05T01:00:00Z")).toBe("2026-10-11T22:00:00.000Z");
  });
  it("handles full days and UTC dates at month/year/DST boundaries", () => {
    const fullDay: UsageActivationRule = { kind: "interval", days: [0, 1, 2, 3, 4, 5, 6], everyMinutes: 60, windows: [{ start: "00:00", end: "24:00" }] };
    expect(next([fullDay], "2026-12-31T23:59:00Z")).toBe("2027-01-01T00:00:00.000Z");
    expect(next([daily], "2026-11-01T03:00:00Z")).toBe("2026-11-02T03:00:00.000Z");
  });
  it.each([
    { ...input, rules: [] }, { ...input, rules: [{ ...daily, days: [] }] },
    { ...input, rules: [{ ...daily, days: [1, 1] }] }, { ...input, rules: [{ ...daily, time: "24:00" }] },
    { ...input, rules: [{ ...interval, everyMinutes: 0 }] }, { ...input, rules: [{ ...interval, everyMinutes: 1.5 }] },
    { ...input, rules: [{ ...interval, windows: [{ start: "08:00", end: "08:00" }] }] },
    { ...input, model: " " }, { ...input, providerId: "missing" }, { ...input, timezone: "Asia/Singapore" }
  ])("rejects malformed or ambiguous input %#", (value) => {
    expect(usageActivationInputSchema.safeParse(value).success).toBe(false);
  });
  it("accepts valid schedules without silently enabling them", () => {
    expect(usageActivationInputSchema.parse(input).enabled).toBe(false);
  });
});

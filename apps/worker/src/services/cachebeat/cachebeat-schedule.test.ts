import { describe, expect, it } from "vitest";
import type { CachebeatSettings, TaskStatus } from "@meowbert/shared";
import { CACHEBEAT_COMPACTION_ROOM_MS, planCachebeat, planCachebeatRetry } from "./cachebeat-plan.js";
import { resolveCachebeatWindowEnd } from "./cachebeat-window.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

// Follows the worker's checks from the last request: waits as told, and every beat reaches the provider.
function simulate(windowEndMs: number, ttlMs = HOUR) {
  let nowMs = 0;
  let cacheReadAtMs = 0;
  const beats: number[] = [];
  for (let step = 0; step < 100; step++) {
    const plan = planCachebeat({ nowMs, cacheReadAtMs, ttlMs, windowEndMs });
    if (plan.kind === "done") return { beats, finishedAtMs: nowMs, expiresAtMs: cacheReadAtMs + ttlMs };
    if (plan.kind === "wait") {
      nowMs += plan.delayMs;
      continue;
    }
    beats.push(nowMs);
    cacheReadAtMs = nowMs;
  }
  throw new Error("cachebeat never finished");
}

function smartWindow(overrides: Partial<{ usedTokens: number; taskStatus: TaskStatus; viewing: boolean; nextRunAtMs: number | null; nowMs: number }>) {
  const settings: CachebeatSettings = { mode: "smart", durationSeconds: 4 * 60 * 60 };
  return resolveCachebeatWindowEnd({
    settings,
    requestStartedAtMs: 0,
    usedTokens: 150_000,
    taskStatus: "awaiting_input",
    viewing: false,
    nextRunAtMs: null,
    nowMs: 0,
    ttlMs: HOUR,
    ...overrides
  });
}

describe("cachebeat schedule", () => {
  it("keeps the cache warm until the window ends and compaction has had time to run", () => {
    for (const windowHours of [0.5, 1, 1.5, 3, 7.25]) {
      const windowEndMs = windowHours * HOUR;
      const result = simulate(windowEndMs);
      expect(result.finishedAtMs).toBeGreaterThanOrEqual(windowEndMs);
      expect(result.expiresAtMs).toBeGreaterThanOrEqual(result.finishedAtMs + CACHEBEAT_COMPACTION_ROOM_MS);
    }
  });

  it("beats as late as is safe, so a three-hour window takes three beats", () => {
    expect(simulate(3 * HOUR).beats).toEqual([50 * MIN, 100 * MIN, 150 * MIN]);
  });

  it("sends no beat when the cache outlives the window on its own", () => {
    expect(simulate(30 * MIN).beats).toEqual([]);
  });

  it("gives up retrying once a beat could no longer land before the cache expires", () => {
    expect(planCachebeatRetry({ nowMs: 50 * MIN, cacheReadAtMs: 0, ttlMs: HOUR })).toEqual({ kind: "wait", delayMs: MIN });
    expect(planCachebeatRetry({ nowMs: 57.5 * MIN, cacheReadAtMs: 0, ttlMs: HOUR })).toEqual({ kind: "done" });
  });
});

describe("smart cachebeat window", () => {
  it("stays warm longest for a large conversation waiting on the user", () => {
    expect(smartWindow({})).toBe(4 * HOUR);
    expect(smartWindow({ taskStatus: "succeeded" })).toBe(2 * HOUR);
    expect(smartWindow({ usedTokens: 50_000 })).toBe(2 * HOUR);
  });

  it("does not keep a small conversation warm, even while someone has it open", () => {
    expect(smartWindow({ usedTokens: 10_000, viewing: true })).toBe(0);
  });

  it("stays warm through the next beat while the task is open, up to the limit", () => {
    expect(smartWindow({ taskStatus: "failed", viewing: true, nowMs: 50 * MIN })).toBe(110 * MIN);
    expect(smartWindow({ taskStatus: "failed", viewing: true, nowMs: 3.5 * HOUR })).toBe(4 * HOUR);
  });

  it("stays warm until a scheduled run inside the limit", () => {
    expect(smartWindow({ taskStatus: "succeeded", nextRunAtMs: 3 * HOUR })).toBe(3 * HOUR);
    expect(smartWindow({ taskStatus: "succeeded", nextRunAtMs: 5 * HOUR })).toBe(2 * HOUR);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ withTransaction: vi.fn(), query: vi.fn() }));
vi.mock("../subagents/dispatch.js", () => ({ enqueueSubagentRun: vi.fn() }));
vi.mock("../project-master/wake.js", () => ({ resolveWakeRoute: vi.fn() }));

import { resolveIdleCompactionDeadlineMs } from "./idle-compaction.js";

describe("resolveIdleCompactionDeadlineMs", () => {
  const minute = 60_000;

  it("uses the cache lifetime when the delay leaves room before it ends", () => {
    expect(resolveIdleCompactionDeadlineMs({ startedAtMs: 0, ttlMs: 60 * minute, delayMs: 48 * minute })).toBe(60 * minute);
  });

  it("allows a margin after the delay when that runs past the cache lifetime", () => {
    expect(resolveIdleCompactionDeadlineMs({ startedAtMs: 0, ttlMs: 60 * minute, delayMs: 58 * minute })).toBe(63 * minute);
  });
});

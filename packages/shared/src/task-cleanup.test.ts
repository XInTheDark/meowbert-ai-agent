import { describe, expect, it } from "vitest";
import {
  parseTaskCleanupSettings,
  normalizeTaskCleanupExpirationDays,
  TASK_CLEANUP_EXPIRATION_DAYS_MAX,
  TASK_CLEANUP_EXPIRATION_DAYS_MIN
} from "./task-cleanup.js";

describe("normalizeTaskCleanupExpirationDays", () => {
  it("accepts whole numbers within range", () => {
    expect(normalizeTaskCleanupExpirationDays(30)).toBe(30);
    expect(normalizeTaskCleanupExpirationDays("14")).toBe(14);
  });

  it("rounds down fractional values", () => {
    expect(normalizeTaskCleanupExpirationDays(7.9)).toBe(7);
  });

  it("rejects values outside allowed range", () => {
    expect(normalizeTaskCleanupExpirationDays(TASK_CLEANUP_EXPIRATION_DAYS_MIN - 1)).toBeNull();
    expect(normalizeTaskCleanupExpirationDays(TASK_CLEANUP_EXPIRATION_DAYS_MAX + 1)).toBeNull();
  });
});

describe("parseTaskCleanupSettings", () => {
  it("returns null expiration when payload is missing", () => {
    expect(parseTaskCleanupSettings(null)).toEqual({ expirationDays: null });
    expect(parseTaskCleanupSettings({})).toEqual({ expirationDays: null });
  });

  it("parses snake_case and camelCase expiration fields", () => {
    expect(
      parseTaskCleanupSettings({
        task_cleanup: { expiration_days: 45 }
      })
    ).toEqual({ expirationDays: 45 });

    expect(
      parseTaskCleanupSettings({
        task_cleanup: { expirationDays: "22" }
      })
    ).toEqual({ expirationDays: 22 });
  });

  it("ignores invalid cleanup payloads", () => {
    expect(
      parseTaskCleanupSettings({
        task_cleanup: { expiration_days: "abc" }
      })
    ).toEqual({ expirationDays: null });
  });
});

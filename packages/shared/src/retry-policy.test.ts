import { describe, expect, it } from "vitest";
import { parseRetryAfterHeaderMs, readRetryAfterMs } from "./retry-policy.js";

describe("parseRetryAfterHeaderMs", () => {
  const nowMs = Date.parse("2026-11-04T00:00:00Z");

  it("reads seconds and HTTP dates", () => {
    expect(parseRetryAfterHeaderMs("90", nowMs)).toBe(90_000);
    expect(parseRetryAfterHeaderMs("Wed, 04 Nov 2026 02:00:00 GMT", nowMs)).toBe(2 * 60 * 60_000);
  });

  it("ignores values that cannot be honored", () => {
    expect(parseRetryAfterHeaderMs("soon", nowMs)).toBeNull();
    expect(parseRetryAfterHeaderMs("Tue, 03 Nov 2026 00:00:00 GMT", nowMs)).toBeNull();
    expect(parseRetryAfterHeaderMs(String(30 * 24 * 60 * 60), nowMs)).toBeNull();
  });
});

describe("readRetryAfterMs", () => {
  it("finds the wait on provider errors and on errors from the Run API", () => {
    expect(readRetryAfterMs({ headers: new Headers({ "Retry-After": "5" }) })).toBe(5_000);
    expect(readRetryAfterMs({ headers: { "retry-after": "5" } })).toBe(5_000);
    expect(readRetryAfterMs({ retryAfterMs: 5_000 })).toBe(5_000);
  });

  it("is null when the error has none", () => {
    expect(readRetryAfterMs(new Error("502 Bad gateway"))).toBeNull();
    expect(readRetryAfterMs({ retryAfterMs: undefined })).toBeNull();
  });
});

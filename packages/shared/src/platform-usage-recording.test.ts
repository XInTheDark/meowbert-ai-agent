import { describe, expect, it, vi } from "vitest";
import { createPlatformUsageRecorder } from "./platform-usage-recording.js";

const settingsRow = {
  usage_rate_multiplier: "2",
  model_metadata_json: {
    "gpt-test": {
      context_window: 256_000,
      usage_multipliers: { input_tokens: 1, cached_input_tokens: 0.1, output_tokens: 4 }
    }
  },
  model_routers_json: []
};

const usage = {
  input_tokens: 1000,
  output_tokens: 50,
  input_tokens_details: { cached_tokens: 600, cache_write_tokens: 100 },
  output_tokens_details: { reasoning_tokens: 0 }
};

function createQuery(options: { failInsert?: boolean } = {}) {
  return vi.fn(async (sql: string) => {
    if (sql.includes("INSERT") && options.failInsert) {
      throw new Error("db down");
    }
    return { rows: sql.includes("platform_settings") ? [settingsRow] : [] };
  });
}

describe("createPlatformUsageRecorder", () => {
  it("records a weighted usage event that prices cache reads and writes separately", async () => {
    const query = createQuery();
    const recorder = createPlatformUsageRecorder(query);

    await recorder.recordResponseUsage({ userId: "user-1", taskId: "task-1", runId: "run-1" }, "gpt-test", usage);

    const insertParams = query.mock.calls.find(([sql]) => sql.includes("INSERT"))?.[1] as unknown[];
    // (300 uncached + 100 writes * 1.25 + 600 cached * 0.1 + 50 output * 4) * rate 2
    expect(insertParams).toEqual(expect.arrayContaining(["user-1", "task-1", "run-1", "gpt-test", 1000, 600, 50]));
    expect(insertParams.at(-1)).toBe(1370);
  });

  it("does not meter calls without billing", async () => {
    const query = createQuery();
    const recorder = createPlatformUsageRecorder(query);

    await recorder.recordResponseUsage(null, "gpt-test", usage);

    expect(query).not.toHaveBeenCalled();
  });

  it("swallows recording failures so the measured call still succeeds", async () => {
    const recorder = createPlatformUsageRecorder(createQuery({ failInsert: true }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recorder.recordResponseUsage({ userId: "user-1", taskId: null, runId: null }, "gpt-test", usage)
    ).resolves.toBeUndefined();
    consoleError.mockRestore();
  });
});

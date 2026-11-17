import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "./execution-types.js";

vi.mock("./context-window.js", () => ({ resetV2ContextWindow: vi.fn(async () => undefined) }));

const { resetV2ContextWindow } = await import("./context-window.js");
const {
  clearExpiredCacheWindow,
  shouldCompactExpiredCache
} = await import("./expired-cache-compaction.js");

const HOUR_MS = 60 * 60 * 1000;
const START_MS = Date.parse("2026-11-16T07:00:00.000Z");

function execution(input: { mode?: string; readAt?: string | null; tokens?: number; lane?: boolean } = {}) {
  const longText = "word ".repeat(input.tokens ?? 200_000);
  return {
    job: { taskId: "task", mode: "default" },
    laneSeed: input.lane ? {} : null,
    maxRunSteps: 50,
    prepared: {
      runtimeModel: "claude-opus-5-5",
      snapshot: {
        idle_compaction_mode: input.mode ?? "full",
        platform_model_metadata: {},
        task: { prompt_cache_read_at: input.readAt === undefined ? "2026-11-16T07:00:00.000Z" : input.readAt }
      },
      control: { emitEvent: vi.fn(async () => undefined), context: {} }
    },
    state: {
      contextManagement: { version: "v2", taskId: "task", windowId: "w1", contextNodeId: "n1" },
      dispatchState: {
        conversationItems: [{ role: "user", content: "Build it" }, { role: "assistant", content: longText }] as ResponseInputItem[],
        runPersistedItems: [] as ResponseInputItem[],
        pendingContextEdits: [],
        pendingContextV2Reset: false
      }
    }
  } as unknown as AgentExecutionContext;
}

describe("expired cache compaction", () => {
  beforeEach(() => {
    vi.mocked(resetV2ContextWindow).mockClear();
  });

  it("waits until the cache lifetime has passed", () => {
    expect(shouldCompactExpiredCache(execution(), START_MS + HOUR_MS - 1)).toBe(false);
    expect(shouldCompactExpiredCache(execution(), START_MS + HOUR_MS)).toBe(true);
  });

  it("measures from this run's latest request once it has made one", () => {
    const run = execution();
    run.state.lastModelRequestStartedAtMs = START_MS + HOUR_MS;
    expect(shouldCompactExpiredCache(run, START_MS + HOUR_MS + 1000)).toBe(false);
  });

  it.each([
    ["standard mode", { mode: "standard" }],
    ["a small conversation", { tokens: 10 }],
    ["no earlier request", { readAt: null }],
    ["a swarm lane", { lane: true }]
  ])("leaves %s alone", (_label, input) => {
    expect(shouldCompactExpiredCache(execution(input), START_MS + 2 * HOUR_MS)).toBe(false);
  });

  it("clears the window without sending the expired conversation again", async () => {
    const run = execution();
    await clearExpiredCacheWindow(run);
    expect(resetV2ContextWindow).toHaveBeenCalledWith(run, "cache_expired");
    expect(run.maxRunSteps).toBe(50);
  });
});

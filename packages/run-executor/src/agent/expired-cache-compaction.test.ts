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

function execution(input: {
  mode?: string;
  readAt?: string | null;
  usedTokens?: number | null;
  tokens?: number;
  lane?: boolean;
} = {}) {
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
        task: {
          prompt_cache_read_at: input.readAt === undefined ? "2026-11-16T07:00:00.000Z" : input.readAt,
          prompt_cache_used_tokens: input.usedTokens ?? null
        }
      },
      control: { emitEvent: vi.fn(async () => undefined), context: {} }
    },
    state: {
      contextManagement: { version: "v2", taskId: "task", windowId: "w1", contextNodeId: "n1" },
      lastActualContextUsage: null,
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

  it("uses provider-measured tokens when conversation item estimation under-counts", () => {
    const run = execution({ tokens: 10_000, usedTokens: 118_000 });
    expect(shouldCompactExpiredCache(run, START_MS + HOUR_MS)).toBe(true);
  });

  it("measures from this run's latest request once it has made one", () => {
    const run = execution();
    run.state.lastModelRequestStartedAtMs = START_MS + HOUR_MS;
    expect(shouldCompactExpiredCache(run, START_MS + HOUR_MS + 1000)).toBe(false);
  });

  it("does not immediately re-clear after a mid-run window reset", () => {
    const run = execution({ usedTokens: 120_000 });
    run.state.lastModelRequestStartedAtMs = null;
    expect(shouldCompactExpiredCache(run, START_MS + 2 * HOUR_MS)).toBe(false);
  });

  it("clears a swarm lane whose own cache expired while leaving freshly forked lanes intact", () => {
    expect(shouldCompactExpiredCache(execution({ lane: true, readAt: null }), START_MS + 2 * HOUR_MS)).toBe(false);
    expect(shouldCompactExpiredCache(execution({ lane: true, tokens: 10, usedTokens: 256_000 }), START_MS + 2 * HOUR_MS)).toBe(true);
  });

  it.each([
    ["standard mode", { mode: "standard" }],
    ["a small conversation", { tokens: 10 }],
    ["no earlier request", { readAt: null }]
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

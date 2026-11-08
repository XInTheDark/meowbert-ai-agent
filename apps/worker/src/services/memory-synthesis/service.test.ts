import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn(async () => ({ rows: [] })), withTransaction: vi.fn() }));
vi.mock("../../lib/redis.js", () => ({ redis: { duplicate: vi.fn() } }));
vi.mock("../runtime/environment-storage.js", () => ({ resolveTaskEnvironmentRoot: vi.fn() }));
vi.mock("../tasks/task-run-dispatch.js", () => ({ insertTaskRunDispatchWithClient: vi.fn() }));
vi.mock("./delta-source.js", () => ({ loadDelta: vi.fn(async () => []), memoryExcludedTasksCte: vi.fn(() => "") }));
vi.mock("./queue.js", () => ({ claimNextMemorySynthesisRequest: vi.fn(async () => null) }));
import { query } from "../../lib/db.js";
import { redis } from "../../lib/redis.js";
import { loadDelta } from "./delta-source.js";
import { claimNextMemorySynthesisRequest } from "./queue.js";
import { processPendingMemorySynthesisRequests, startMemorySynthesisEventListener } from "./service.js";

const request = (id: string) => ({ id, workspace_id: "workspace", environment_id: `project-${id}`, initiator_user_id: null, source_through_at: null });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(claimNextMemorySynthesisRequest).mockResolvedValue(null); });
afterEach(() => vi.useRealTimers());

describe("Memory refresh queue recovery", () => {
  it("drains sibling Project requests without needing another user message", async () => {
    vi.mocked(claimNextMemorySynthesisRequest).mockResolvedValueOnce(request("one")).mockResolvedValueOnce(request("two"));
    await processPendingMemorySynthesisRequests();
    expect(loadDelta).toHaveBeenCalledWith({ environmentId: "project-one", sourceAfter: null });
    expect(loadDelta).toHaveBeenCalledWith({ environmentId: "project-two", sourceAfter: null });
    expect(claimNextMemorySynthesisRequest).toHaveBeenCalledTimes(3);
    const parameters = vi.mocked(query).mock.calls.map(([, args]) => args);
    expect(parameters).toContainEqual(["one"]);
    expect(parameters).toContainEqual(["two"]);
  });

  it("continues after a failed refresh preparation and keeps each recovery batch bounded", async () => {
    vi.mocked(claimNextMemorySynthesisRequest).mockResolvedValue(request("next"));
    vi.mocked(loadDelta).mockRejectedValueOnce(new Error("source unavailable"));
    await processPendingMemorySynthesisRequests();
    expect(claimNextMemorySynthesisRequest).toHaveBeenCalledTimes(20);
    expect(query).toHaveBeenCalledWith(expect.any(String), ["next", "source unavailable"]);
    expect(loadDelta).toHaveBeenCalledTimes(20);
  });

  it("rechecks queued work periodically and stops recovery when the listener stops", async () => {
    vi.useFakeTimers();
    const subscriber = { on: vi.fn(), subscribe: vi.fn(async () => {}), unsubscribe: vi.fn(async () => {}), quit: vi.fn(async () => {}) };
    vi.mocked(redis.duplicate).mockReturnValue(subscriber as never);
    const listener = startMemorySynthesisEventListener();
    await vi.advanceTimersByTimeAsync(0);
    expect(claimNextMemorySynthesisRequest).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(claimNextMemorySynthesisRequest).toHaveBeenCalledTimes(2);
    await listener.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(claimNextMemorySynthesisRequest).toHaveBeenCalledTimes(2);
    expect(subscriber.quit).toHaveBeenCalledOnce();
  });
});

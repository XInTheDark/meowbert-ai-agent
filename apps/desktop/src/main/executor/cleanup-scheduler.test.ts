import { afterEach, expect, it, vi } from "vitest";
const apply = vi.hoisted(() => vi.fn());
vi.mock("../workspace-files/tombstones", () => ({applyDeviceTombstones:apply}));
import { createCleanupScheduler } from "./cleanup-scheduler";
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it("schedules a single server-relative cleanup deadline then remains idle", async () => {
  vi.useFakeTimers();
  apply.mockResolvedValueOnce({nextCheckInMs:90_000,retryNeeded:false}).mockResolvedValue({nextCheckInMs:null,retryNeeded:false});
  const abort = new AbortController();
  const cleanup = createCleanupScheduler({deviceId:"d",scratchRoot:"/scratch"} as never, {} as never, abort.signal,new Map());
  await cleanup.request(); expect(apply).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(89_999); expect(apply).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(apply).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(600_000); expect(apply).toHaveBeenCalledTimes(2); abort.abort();
});
it("defers admissions while deleting and reports current active workspaces", async () => {
  let finish: (value: unknown) => void = () => {};
  apply.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const runs=new Map([['r',{workspaceId:'busy'}]]); const abort = new AbortController(); const onIdle=vi.fn();
  const cleanup=createCleanupScheduler({deviceId:'d'} as never,{} as never,abort.signal,runs as never,onIdle);
  const work=cleanup.request(); await Promise.resolve(); expect(cleanup.isBusy()).toBe(true);
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({activeWorkspaceIds:new Set(['busy'])}));
  finish({nextCheckInMs:null,retryNeeded:false}); await work; expect(cleanup.isBusy()).toBe(false); expect(onIdle).toHaveBeenCalledOnce();
  abort.abort();
});

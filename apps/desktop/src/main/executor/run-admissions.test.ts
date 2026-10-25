import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopLocalExecutorOptions } from "./local-executor";
import type { LocalExecutionReadiness } from "./local-readiness";
import type { DeviceApi } from "./device-api";
const start=vi.hoisted(()=>vi.fn());
vi.mock("./local-run",()=>({startLocalRun:start}));
import { RunAdmissions } from "./run-admissions";
import { DeviceApiError } from "./device-api";
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();});
afterEach(()=>vi.useRealTimers());
function fixture() {
  const signal=new AbortController();const done=vi.fn();const runs=new Map();
  const readiness: Pick<LocalExecutionReadiness, "ready" | "capabilities"> = {ready:{image:"image",skillsRoot:"skills",settings:{maxSteps:10,commandTimeoutMs:1000,maxCommandOutputKb:10,shell:"/bin/sh",skills:{rootDir:"/skills"}},installId:"install"},capabilities:{sandboxImageReady:true}};
  const admissions=new RunAdmissions({} as DesktopLocalExecutorOptions,{} as DeviceApi,signal.signal,readiness,runs,()=>false,done);
  const entry={run_id:"r",admitted_at:"first",queue_state:"admitted",payload_json:{executionTarget:{kind:"local",mode:"sandbox"}}};
  return {signal,done,runs,admissions,entry};
}
it("ignores stale admitted snapshots after completion but accepts a newly admitted attempt",async()=>{
  start.mockReturnValue({done:Promise.resolve()});const f=fixture();
  f.admissions.receive([f.entry]);await vi.advanceTimersByTimeAsync(0);
  expect(f.runs.size).toBe(0);f.admissions.resume();f.admissions.receive([f.entry]);
  expect(start).toHaveBeenCalledOnce();
  f.admissions.receive([{...f.entry,admitted_at:"second"}]);expect(start).toHaveBeenCalledTimes(2);
  f.signal.abort();
});
it("backs off transient claim failures without Docker checks, then stops retries on shutdown",async()=>{
  start.mockReturnValue({done:Promise.reject(new DeviceApiError(503,"/claim","POST","Worker unreachable"))});
  const f=fixture();f.admissions.receive([f.entry]);await vi.advanceTimersByTimeAsync(0);
  f.admissions.resume();expect(start).toHaveBeenCalledOnce();
  start.mockReturnValue({done:new Promise(()=>{})});await vi.advanceTimersByTimeAsync(1_200);
  expect(start).toHaveBeenCalledTimes(2);f.signal.abort();await vi.advanceTimersByTimeAsync(60_000);
  expect(start).toHaveBeenCalledTimes(2);
});
it("does not automatically retry permanent claim refusals",async()=>{
  start.mockReturnValue({done:Promise.reject(new DeviceApiError(409,"/claim","POST"))});const f=fixture();
  f.admissions.receive([f.entry]);await vi.advanceTimersByTimeAsync(60_000);
  expect(start).toHaveBeenCalledOnce();f.signal.abort();
});

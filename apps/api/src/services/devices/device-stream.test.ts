import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FastifyReply } from "fastify";
const state = vi.hoisted(() => ({query:vi.fn(),subscribe:vi.fn(),off:vi.fn()}));
vi.mock("../../lib/db.js", () => ({query:state.query}));
vi.mock("./device-events.js", () => ({deviceEvents:{subscribe:state.subscribe}}));
import { streamDeviceRuns } from "./device-stream.js";
function reply() {
  const raw = Object.assign(new EventEmitter(), {destroyed:false,writeHead:vi.fn(),write:vi.fn(),end:vi.fn()});
  raw.end.mockImplementation(() => {if (!raw.destroyed) {raw.destroyed=true;raw.emit("close");}});
  const result = {raw,hijack:vi.fn(),status:vi.fn(),send:vi.fn()}; result.status.mockReturnValue(result);
  return result;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  state.query.mockResolvedValue({rowCount:1,rows:[]}); state.subscribe.mockResolvedValue(state.off);
});
afterEach(() => vi.useRealTimers());
it("subscribes before the initial snapshot, then sends only pushed heartbeat requests while idle", async () => {
  const response = reply(); await streamDeviceRuns("device","owner",response as unknown as FastifyReply,true);
  expect(state.subscribe.mock.invocationCallOrder[0]).toBeLessThan(state.query.mock.invocationCallOrder[0]);
  expect(state.query.mock.calls.filter(([sql])=>sql.includes("FROM task_run_dispatches"))).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(state.query.mock.calls.filter(([sql])=>sql.includes("FROM task_run_dispatches"))).toHaveLength(1);
  expect(state.query.mock.calls.filter(([sql])=>sql.includes("last_seen_at"))).toHaveLength(1);
  expect(response.raw.write.mock.calls.filter(([data])=>data.startsWith("event: ping"))).toHaveLength(6);
  const callback = state.subscribe.mock.calls[0][0]; callback.event("runs"); await vi.advanceTimersByTimeAsync(1);
  expect(state.query.mock.calls.filter(([sql])=>sql.includes("FROM task_run_dispatches"))).toHaveLength(2);
  callback.event("config"); expect(response.raw.write).toHaveBeenCalledWith('event: config\ndata: {}\n\n');
  response.raw.emit("close"); expect(state.off).toHaveBeenCalledOnce();
  expect(state.query).toHaveBeenLastCalledWith(expect.stringContaining("AND stream_connection_id = $3"),["device","owner",expect.any(String)]);
});
it("rejects a device owned by someone else before streaming any runs", async () => {
  state.query.mockResolvedValueOnce({rowCount:0,rows:[]}); const response=reply();
  await streamDeviceRuns("device","wrong-owner",response as unknown as FastifyReply,true);
  expect(response.status).toHaveBeenCalledWith(404); expect(response.hijack).not.toHaveBeenCalled();
  expect(state.query).toHaveBeenCalledTimes(1); expect(state.off).toHaveBeenCalledOnce();
});
it("closes immediately on revocation or lost notification delivery", async () => {
  const response=reply(); await streamDeviceRuns("device","owner",response as unknown as FastifyReply,true);
  state.subscribe.mock.calls[0][0].event("revoked"); expect(response.raw.end).toHaveBeenCalledOnce();
  const count=state.query.mock.calls.length; await vi.advanceTimersByTimeAsync(60_000); expect(state.query).toHaveBeenCalledTimes(count);
});
it("does not expire another connection's lease when the older stream closes", async () => {
  const first=reply();const second=reply();
  await streamDeviceRuns("device","owner",first as unknown as FastifyReply,true);
  await streamDeviceRuns("device","owner",second as unknown as FastifyReply,true);
  const ids=state.query.mock.calls.filter(([sql])=>sql.includes("SET stream_connection_id")).map(([,args])=>args[2]);
  first.raw.emit("close");
  expect(ids[0]).not.toBe(ids[1]);
  expect(state.query).toHaveBeenLastCalledWith(expect.stringContaining("stream_connection_id = $3"),["device","owner",ids[0]]);
  second.raw.emit("close");
});
it("closes on snapshot failure so reconnect recovers instead of advertising an empty queue", async () => {
  state.query.mockResolvedValueOnce({rowCount:1,rows:[]}).mockRejectedValueOnce(new Error("db offline"));
  const response=reply(); await streamDeviceRuns("device","owner",response as unknown as FastifyReply,true);
  expect(response.raw.end).toHaveBeenCalledOnce(); expect(state.off).toHaveBeenCalledOnce();
});

it("keeps older desktops online using their existing heartbeat without resuming queue polling",async()=>{
  const response=reply();await streamDeviceRuns("device","owner",response as unknown as FastifyReply);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(state.query.mock.calls.filter(([sql])=>sql.includes("FROM task_run_dispatches"))).toHaveLength(1);
  expect(state.query.mock.calls.filter(([sql])=>sql.includes("SET stream_expires_at = now() +"))).toHaveLength(3);
  response.raw.emit("close");
});

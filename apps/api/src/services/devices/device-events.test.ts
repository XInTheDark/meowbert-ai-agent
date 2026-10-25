import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
const connect = vi.hoisted(() => vi.fn());
vi.mock("../../lib/db.js", () => ({ pool: { connect } }));
import { DeviceEvents } from "./device-events.js";
function client() { return Object.assign(new EventEmitter(), { query: vi.fn().mockResolvedValue({}), release: vi.fn() }); }
beforeEach(() => vi.clearAllMocks());
it("shares one LISTEN connection, scopes device events and broadcasts config without polling", async () => {
  const db = client(); connect.mockResolvedValue(db);
  const hub = new DeviceEvents(); const a = vi.fn(); const b = vi.fn();
  const [offA, offB] = await Promise.all([
    hub.subscribe({deviceId:"a",event:a,close:vi.fn()}), hub.subscribe({deviceId:"b",event:b,close:vi.fn()})
  ]);
  expect(connect).toHaveBeenCalledOnce();
  db.emit("notification", {channel:"device_execution_changed",payload:JSON.stringify({deviceId:"a",kind:"runs"})});
  expect(a).toHaveBeenCalledWith("runs"); expect(b).not.toHaveBeenCalled();
  db.emit("notification", {channel:"device_execution_changed",payload:JSON.stringify({deviceId:null,kind:"config"})});
  expect(b).toHaveBeenCalledWith("config"); expect(db.query).toHaveBeenCalledTimes(1);
  offA(); expect(db.release).not.toHaveBeenCalled(); offB(); expect(db.release).toHaveBeenCalledWith(true);
});
it("closes streams when notifications fail and establishes a new listener for reconnect catch-up", async () => {
  const first = client(); const second = client(); connect.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const hub = new DeviceEvents(); const close = vi.fn();
  await hub.subscribe({deviceId:"a",event:vi.fn(),close});
  first.emit("error", new Error("connection lost")); expect(close).toHaveBeenCalledOnce();
  const off = await hub.subscribe({deviceId:"a",event:vi.fn(),close:vi.fn()});
  expect(second.query).toHaveBeenCalledWith("LISTEN device_execution_changed"); off();
});
it("releases failed listeners without stranding subscriptions", async () => {
  const db = client(); db.query.mockRejectedValueOnce(new Error("listen failed")); connect.mockResolvedValue(db);
  const hub = new DeviceEvents(); const close = vi.fn();
  await expect(hub.subscribe({deviceId:"a",event:vi.fn(),close})).rejects.toThrow("listen failed");
  expect(db.release).toHaveBeenCalledWith(true); expect(close).toHaveBeenCalledOnce();
});

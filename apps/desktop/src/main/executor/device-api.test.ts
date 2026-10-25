import { expect, it, vi } from "vitest";
import { createDeviceApi, DeviceApiError } from "./device-api";
import { deviceRetryDelay } from "./retry-delay";

it("reports the failed route and server diagnostic without including credentials or query values", async () => {
  const api = createDeviceApi({ apiBaseUrl: "https://server.test", token: "private-token",
    fetch: vi.fn().mockResolvedValue(Response.json({ error: "The worker holding local runs is unreachable." }, { status: 503 }))
  }, new AbortController().signal);
  const error = await api.request("/api/devices/device/runs/run/claim?secret=private").catch((value) => value);
  expect(error).toBeInstanceOf(DeviceApiError);
  if (!(error instanceof DeviceApiError)) throw new Error("Expected DeviceApiError");
  expect(error.status).toBe(503);
  expect(error.route).not.toContain("private");
  expect(error.message).toContain("GET /api/devices/device/runs/run/claim, HTTP 503");
  expect(error.message).toContain("The worker holding local runs is unreachable.");
  expect(error.message).not.toContain("private");
});

it("does not display proxy HTML as a server error", async () => {
  const api = createDeviceApi({ apiBaseUrl: "https://server.test", token: "token",
    fetch: vi.fn().mockResolvedValue(new Response("<html>proxy failure</html>", { status: 503 }))
  }, new AbortController().signal);
  await expect(api.request("/api/local-execution/config")).rejects.toThrow("HTTP 503");
});

it("backs off repeated failures with a capped jittered delay", () => {
  const delays = [0, 1, 2, 3, 4, 5, 6, 20].map((attempt) => deviceRetryDelay(attempt, () => 0.5));
  expect(delays.slice(0, 4)).toEqual([1000, 2000, 4000, 8000]);
  expect(Math.max(...delays)).toBe(60_000);
  expect(deviceRetryDelay(20, () => 1)).toBe(60_000);
  expect(deviceRetryDelay(0, () => 0)).toBeLessThan(deviceRetryDelay(0, () => 1));
});

it("delivers pushed config and heartbeat data across split SSE frames", async () => {
  const encoder = new TextEncoder(); const events = vi.fn(); const runs = vi.fn();
  const body = new ReadableStream<Uint8Array>({start(controller) {
    for (const chunk of ['event: config\r', '\ndata: {}\r\n\r', '\nevent: ping\ndata: {"connectionId":"connection"}\n\nevent: runs\ndata: [{"run_id":"r"}]\n\n']) controller.enqueue(encoder.encode(chunk));
    controller.close();
  }});
  const api=createDeviceApi({apiBaseUrl:"https://server.test",token:"token",fetch:vi.fn().mockResolvedValue(new Response(body))},new AbortController().signal);
  await api.stream("/stream",runs,events);
  expect(events.mock.calls).toEqual([["config",{}],["ping",{connectionId:"connection"}]]);
  expect(runs).toHaveBeenCalledWith([{run_id:"r"}]);
});

it("aborts a silent connection so the supervisor can reconnect", async () => {
  vi.useFakeTimers();
  try {
    const fetchImpl=vi.fn((_url:unknown,init:RequestInit|undefined)=>new Promise<Response>((_resolve,reject)=>{
      init?.signal?.addEventListener("abort",()=>reject(init.signal?.reason),{once:true});
    }));
    const api=createDeviceApi({apiBaseUrl:"https://server.test",token:"token",fetch:fetchImpl as typeof fetch},new AbortController().signal);
    const outcome=api.stream("/stream",()=>{}).catch(error=>error);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await outcome).toMatchObject({message:"Device connection timed out."});
  } finally {vi.useRealTimers();}
});

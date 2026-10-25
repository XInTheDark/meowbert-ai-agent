import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { RUN_API_MODEL_STREAM_CONTENT_TYPE } from "@meowbert/shared";
import { createRunApiServer } from "./server.js";

it("sends recurring keepalives before a slow model finishes and preserves its final error", async () => {
  let finish!: (reply: { status: number; body: unknown }) => void;
  const model = vi.fn(() => new Promise<{ status: number; body: unknown }>((resolve) => { finish = resolve; }));
  const server = createRunApiServer({ model, call: vi.fn() }, { modelHeartbeatMs: 5 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/runs/run/model/responses`, {
      method: "POST", headers: { accept: RUN_API_MODEL_STREAM_CONTENT_TYPE }, body: "{}", signal: AbortSignal.timeout(1_000)
    });
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("heartbeat");
    expect(decoder.decode((await reader.read()).value)).toContain("heartbeat");
    const error = { error: { code: "quota_exceeded", message: "No quota" } };
    finish({ status: 402, body: error });
    let remaining = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      remaining += decoder.decode(chunk.value, { stream: true });
    }
    expect(remaining.trim().split("\n").map((line) => JSON.parse(line)))
      .toContainEqual({ type: "result", status: 402, body: error });
    expect(model).toHaveBeenCalledOnce();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("keeps the JSON response contract for executors that do not request a stream", async () => {
  const body = { response: { output: [] }, weightedTokens: 1 };
  const server = createRunApiServer({ model: vi.fn().mockResolvedValue({ status: 200, body }), call: vi.fn() });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/runs/run/model/responses`, {
      method: "POST", body: "{}"
    });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual(body);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

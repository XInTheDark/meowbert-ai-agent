import http from "node:http";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { RUN_API_MODEL_STREAM_CONTENT_TYPE } from "@meowbert/shared";
import { signRunLeaseToken } from "@meowbert/shared/run-lease-token";

vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../../lib/config.js", () => ({ config: { localExecution: { enabled: true }, security: { jwtSecret: "secret" } } }));
import { query } from "../../lib/db.js";
import { runApiRoutes } from "./index.js";

it.each(["", "/replay"])("passes model keepalives through the public API%s before the worker returns a result", async (suffix) => {
  let workerResponse!: http.ServerResponse;
  const worker = http.createServer((request, response) => {
    expect(request.headers.accept).toBe(RUN_API_MODEL_STREAM_CONTENT_TYPE);
    expect(request.url).toBe("/runs/11111111-1111-4111-8111-111111111111/model/responses" + suffix);
    workerResponse = response;
    response.writeHead(200, { "content-type": RUN_API_MODEL_STREAM_CONTENT_TYPE });
    response.write('{"type":"heartbeat"}\n');
  });
  await new Promise<void>((resolve) => worker.listen(0, "127.0.0.1", resolve));
  vi.mocked(query).mockResolvedValue({ rows: [{ lease_api_url: `http://127.0.0.1:${(worker.address() as AddressInfo).port}`, lease_epoch: 1 }] } as never);
  const app = Fastify();
  await app.register(runApiRoutes);
  await app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const runId = "11111111-1111-4111-8111-111111111111";
    const token = signRunLeaseToken({ runId, taskId: "task", epoch: 1, holder: "device:desktop" }, "secret");
    const response = await fetch(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/runs/${runId}/model/responses${suffix}`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, accept: RUN_API_MODEL_STREAM_CONTENT_TYPE, "content-type": "application/json" },
      body: "{}", signal: AbortSignal.timeout(2_000)
    });
    expect(response.headers.get("content-type")).toContain(RUN_API_MODEL_STREAM_CONTENT_TYPE);
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("heartbeat");
    workerResponse.end('{"type":"result","status":200,"body":{}}\n');
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("result");
    expect((await reader.read()).done).toBe(true);
  } finally {
    worker.closeAllConnections();
    app.server.closeAllConnections();
    await app.close();
    await new Promise<void>((resolve) => worker.close(() => resolve()));
  }
});

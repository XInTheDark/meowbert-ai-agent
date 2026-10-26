import { expect, it, vi } from "vitest";
import { RUN_API_MODEL_STREAM_CONTENT_TYPE } from "@meowbert/shared";
import { createRunApiClient } from "./client.js";

const request = { purpose: "turn" as const, body: { input: [] }, timeoutMs: 1_000 };
const result = { response: { output: [{ text: "Hello 世界" }] }, weightedTokens: 7 };
const encoder = new TextEncoder();

function fixture(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);
  return { fetch, client: createRunApiClient({ baseUrl: "https://server/api", runId: "run", token: "lease", fetch, retryDelaysMs: [] }) };
}

it("reads heartbeat frames and a UTF-8 result split across network chunks", async () => {
  const bytes = encoder.encode(JSON.stringify({ type: "heartbeat" }) + "\n"
    + JSON.stringify({ type: "result", status: 200, body: result }) + "\n");
  const body = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const test = fixture(new Response(body, { headers: { "content-type": RUN_API_MODEL_STREAM_CONTENT_TYPE } }));
  await expect(test.client.model(request)).resolves.toEqual(result);
  expect(test.fetch).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.objectContaining({
    headers: expect.objectContaining({ accept: RUN_API_MODEL_STREAM_CONTENT_TYPE })
  }));
});

it.each([
  { status: 409, code: "lease_lost", currentLeafId: "leaf" },
  { status: 429, code: "rate_limited", currentLeafId: null },
  { status: 500, code: "internal", currentLeafId: null }
])("preserves streamed error status $status without resending the model call", async (error) => {
  const test = fixture(new Response(JSON.stringify({ type: "result", status: error.status,
    body: { error: { ...error, message: "Upstream error" } } }) + "\n",
  { headers: { "content-type": RUN_API_MODEL_STREAM_CONTENT_TYPE } }));
  await expect(test.client.model(request)).rejects.toMatchObject({ ...error, message: "Upstream error" });
  expect(test.fetch).toHaveBeenCalledOnce();
});

it("rejects a disconnected stream before a result without replaying provider work", async () => {
  const test = fixture(new Response('{"type":"heartbeat"}\n',
    { headers: { "content-type": RUN_API_MODEL_STREAM_CONTENT_TYPE } }));
  await expect(test.client.model(request)).rejects.toThrow("ended before a result");
  expect(test.fetch).toHaveBeenCalledOnce();
});

it("accepts buffered JSON from an older server", async () => {
  const test = fixture(Response.json(result));
  await expect(test.client.model(request)).resolves.toEqual(result);
});

it.each(["fetch", "stream"])("rejoins the same operation after a lost %s response", async (lost) => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(result));
  if (lost === "fetch") fetch.mockReset().mockRejectedValueOnce(new TypeError("fetch failed"));
  else fetch.mockReset().mockResolvedValueOnce(new Response('{"type":"heartbeat"}\n',
    { headers: { "content-type": RUN_API_MODEL_STREAM_CONTENT_TYPE } }));
  fetch.mockResolvedValueOnce(Response.json(result));
  const client = createRunApiClient({ baseUrl: "https://server/api", runId: "run", token: "lease", fetch, retryDelaysMs: [0] });
  await expect(client.model(request)).resolves.toEqual(result);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "https://server/api/runs/run/model/responses", "https://server/api/runs/run/model/responses/replay"
  ]);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});

it("reports an unknown outcome after transport retries are exhausted", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("terminated"));
  const client = createRunApiClient({ baseUrl: "https://server/api", runId: "run", token: "lease", fetch, retryDelaysMs: [0, 0] });
  await expect(client.model(request)).rejects.toMatchObject({ code: "outcome_unknown" });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(new Set(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).operationId)).size).toBe(1);
});

it.each([502, 503, 504])("reconciles a %s gateway failure using the original operation id", async (status) => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: "internal", message: "Worker unreachable" } }, { status }))
    .mockResolvedValueOnce(Response.json(result));
  const client = createRunApiClient({ baseUrl: "https://server/api", runId: "run", token: "lease", fetch, retryDelaysMs: [0] });
  await expect(client.model(request)).resolves.toEqual(result);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  expect(fetch.mock.calls[1][0]).toContain("/replay");
});

it("does not replay work through the ordinary endpoint when an older server lacks replay", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("terminated"))
    .mockResolvedValueOnce(Response.json({ error: { code: "invalid_request", message: "Not found" } }, { status: 404 }));
  const client = createRunApiClient({ baseUrl: "https://server/api", runId: "run", token: "lease", fetch, retryDelaysMs: [0, 0] });
  await expect(client.model(request)).rejects.toMatchObject({ code: "outcome_unknown" });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("cancels promptly while waiting to reconnect", async () => {
  const controller = new AbortController();
  const fetch = vi.fn().mockRejectedValue(new TypeError("terminated"));
  const client = createRunApiClient({ baseUrl: "https://server/api", runId: "run", token: "lease", fetch, retryDelaysMs: [30_000] });
  const pending = client.model(request, controller.signal);
  const outcome = expect(pending).rejects.toThrow("TASK_CANCELLED");
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  controller.abort(new Error("TASK_CANCELLED"));
  await outcome;
  expect(fetch).toHaveBeenCalledOnce();
});

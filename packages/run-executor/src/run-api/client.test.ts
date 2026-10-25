import { expect, it, vi } from "vitest";
import { RUN_API_MODEL_STREAM_CONTENT_TYPE } from "@meowbert/shared";
import { createRunApiClient } from "./client.js";

const request = { purpose: "turn" as const, body: { input: [] }, timeoutMs: 1_000 };
const result = { response: { output: [{ text: "Hello 世界" }] }, weightedTokens: 7 };
const encoder = new TextEncoder();

function fixture(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);
  return { fetch, client: createRunApiClient({ baseUrl: "https://server/api", runId: "run", token: "lease", fetch }) };
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

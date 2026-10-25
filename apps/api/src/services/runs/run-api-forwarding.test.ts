import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { RUN_API_MODEL_STREAM_CONTENT_TYPE } from "@meowbert/shared";
import { signRunLeaseToken } from "@meowbert/shared/run-lease-token";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import { forwardRunApiRequest, resolveRunLeaseHolderUrl, verifyRunLease } from "./run-api-forwarding.js";

const SECRET = "secret";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());

function token(overrides: { runId?: string; epoch?: number; secret?: string } = {}): string {
  return `Bearer ${signRunLeaseToken({ runId: overrides.runId ?? RUN_ID, taskId: "task-1", epoch: overrides.epoch ?? 3, holder: "worker" }, overrides.secret ?? SECRET)}`;
}

describe("Run API forwarding", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it("accepts only a token signed for this run", () => {
    expect(verifyRunLease(token(), RUN_ID, SECRET)).toMatchObject({ runId: RUN_ID, epoch: 3 });
    expect(() => verifyRunLease(token({ runId: "22222222-2222-4222-8222-222222222222" }), RUN_ID, SECRET)).toThrow("another run");
    expect(() => verifyRunLease(token({ secret: "other" }), RUN_ID, SECRET)).toThrow("Invalid");
    expect(() => verifyRunLease(undefined, RUN_ID, SECRET)).toThrow("Missing");
  });

  it("forwards to the worker holding the current epoch, and refuses an older one", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ lease_api_url: "http://worker:4100/", lease_epoch: 3 }] } as never);
    await expect(resolveRunLeaseHolderUrl(verifyRunLease(token(), RUN_ID, SECRET))).resolves.toBe("http://worker:4100");

    await expect(resolveRunLeaseHolderUrl(verifyRunLease(token({ epoch: 2 }), RUN_ID, SECRET))).rejects.toMatchObject({ code: "lease_lost" });
  });
});

it("forwards the first model heartbeat before the upstream model has finished", async () => {
  const encoder = new TextEncoder();
  let upstream!: ReadableStreamDefaultController<Uint8Array>;
  const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { upstream = controller; } }),
    { headers: { "content-type": RUN_API_MODEL_STREAM_CONTENT_TYPE } }));
  vi.stubGlobal("fetch", fetch);
  const reply = await forwardRunApiRequest({ holderUrl: "http://worker", path: "/runs/run/model/responses",
    authorization: "Bearer lease", body: {}, signal: new AbortController().signal, streamModel: true });
  expect(reply.contentType).toBe(RUN_API_MODEL_STREAM_CONTENT_TYPE);
  expect(reply.body).toBeInstanceOf(Readable);
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    headers: expect.objectContaining({ accept: RUN_API_MODEL_STREAM_CONTENT_TYPE })
  }));
  const chunks = (reply.body as Readable)[Symbol.asyncIterator]();
  upstream.enqueue(encoder.encode('{"type":"heartbeat"}\n'));
  expect(String((await chunks.next()).value)).toContain("heartbeat");
  upstream.enqueue(encoder.encode('{"type":"result","status":200,"body":{}}\n'));
  upstream.close();
  expect(String((await chunks.next()).value)).toContain("result");
  expect((await chunks.next()).done).toBe(true);
});

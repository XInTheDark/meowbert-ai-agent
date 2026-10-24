import http from "node:http";
import type { RunApiHandler, RunApiReply } from "./handler.js";

// Model requests carry the whole conversation, images included.
const MAX_BODY_BYTES = 64 * 1024 * 1024;

const CALL_ROUTE = /^\/runs\/([^/]+)\/call\/([a-zA-Z.]+)$/;
const MODEL_ROUTE = /^\/runs\/([^/]+)\/model\/responses$/;
const CLAIM_ROUTE = /^\/runs\/([^/]+)\/claim$/;

class BodyTooLargeError extends Error {}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: http.ServerResponse, reply: RunApiReply): void {
  if (response.destroyed) return;
  response.writeHead(reply.status, { "content-type": "application/json" });
  response.end(JSON.stringify(reply.body));
}

export interface RunApiServerOptions {
  claim?: (input: { runId: string; deviceId: string; body: unknown; secret: string | undefined }) => Promise<RunApiReply>;
}

async function route(handler: RunApiHandler, request: http.IncomingMessage, response: http.ServerResponse, options: RunApiServerOptions): Promise<RunApiReply | null> {
  const path = new URL(request.url ?? "/", "http://run-api").pathname;
  if (request.method !== "POST") return { status: 404, body: { error: { code: "invalid_request", message: "Not found." } } };
  const call = CALL_ROUTE.exec(path);
  const model = call ? null : MODEL_ROUTE.exec(path);
  const claim = call || model ? null : CLAIM_ROUTE.exec(path);
  if (!call && !model && !claim) return { status: 404, body: { error: { code: "invalid_request", message: "Not found." } } };
  const body = await readJson(request);
  const authorization = request.headers.authorization;
  if (claim) {
    if (!options.claim) return { status: 404, body: { error: { code: "invalid_request", message: "Not found." } } };
    return options.claim({
      runId: decodeURIComponent(claim[1]),
      deviceId: request.headers["x-meowbert-device-id"] as string,
      body,
      secret: request.headers["x-meowbert-run-api-secret"] as string | undefined
    });
  }
  if (call) {
    return handler.call({ runId: decodeURIComponent(call[1]), method: call[2], authorization, body });
  }
  // The upstream request stops when the executor goes away mid-request.
  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort(new Error("RUN_API_CLIENT_DISCONNECTED"));
  });
  return handler.model({ runId: decodeURIComponent(model![1]), authorization, body, signal: controller.signal });
}

// The worker's internal Run API listener. Executors reach it through the API, which forwards a
// run's calls to the worker holding its lease.
export function createRunApiServer(handler: RunApiHandler, options: RunApiServerOptions = {}): http.Server {
  return http.createServer((request, response) => {
    route(handler, request, response, options)
      .then((reply) => reply && send(response, reply))
      .catch((error: unknown) => {
        const status = error instanceof BodyTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 500;
        send(response, { status, body: { error: { code: status === 500 ? "internal" : "invalid_request", message: error instanceof Error ? error.message : String(error) } } });
      });
  });
}

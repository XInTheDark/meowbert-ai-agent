import type http from "node:http";
import { RUN_API_MODEL_STREAM_CONTENT_TYPE, type RunApiModelStreamEvent } from "@meowbert/shared";
import { errorReply, type RunApiReply } from "./replies.js";

// Keep the executor connection active while the provider is thinking or waiting for a slot.
export async function streamModelReply(
  response: http.ServerResponse, work: () => Promise<RunApiReply>, heartbeatMs = 10_000
): Promise<void> {
  response.writeHead(200, { "content-type": RUN_API_MODEL_STREAM_CONTENT_TYPE,
    "cache-control": "no-store, no-transform", "x-accel-buffering": "no" });
  const heartbeat: RunApiModelStreamEvent = { type: "heartbeat" };
  const ping = () => { if (!response.destroyed) response.write(JSON.stringify(heartbeat) + "\n"); };
  ping();
  const timer = setInterval(ping, heartbeatMs);
  timer.unref();
  const closed = () => clearInterval(timer);
  response.once("close", closed);
  try {
    const reply = await work().catch(errorReply);
    const result: RunApiModelStreamEvent = { type: "result", status: reply.status, body: reply.body };
    if (!response.destroyed) response.end(JSON.stringify(result) + "\n");
  } finally {
    clearInterval(timer);
    response.removeListener("close", closed);
  }
}

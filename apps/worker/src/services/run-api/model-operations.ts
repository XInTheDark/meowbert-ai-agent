import { createHash } from "node:crypto";
import type { RunApiErrorBody, RunApiErrorCode, RunApiModelRequest, RunApiModelResponse } from "@meowbert/shared";
import { canonicalizeModelPayload } from "@meowbert/run-executor/agent/model";
import { RunApiFailure } from "./failure.js";
import { errorReply } from "./replies.js";
import type { RunApiSession } from "./sessions.js";
import type { RunOperationStore, StoredOperationResponse } from "./stores.js";

// Allow the executor's transport retries to rejoin work before cancelling an abandoned call.
const RECONNECT_GRACE_MS = 5_000;

interface ModelOperation {
  id: string;
  hash: string;
  controller: AbortController;
  result: Promise<RunApiModelResponse>;
  waiters: number;
  settled: boolean;
  started: boolean;
  disconnectTimer?: NodeJS.Timeout;
}

const operations = new WeakMap<RunApiSession, ModelOperation>();

export function abortModelOperation(session: RunApiSession): void {
  const operation = operations.get(session);
  if (operation && !operation.settled) operation.controller.abort(new RunApiFailure("lease_lost", "This run's lease has ended."));
}

function restoreResult(response: StoredOperationResponse): RunApiModelResponse {
  if (response.ok) return response.result as RunApiModelResponse;
  throw new RunApiFailure(response.error.code as RunApiErrorCode, response.error.message, response.error.currentLeafId ?? null);
}

async function runOnce(
  session: RunApiSession, operation: ModelOperation, store: RunOperationStore,
  create: (signal: AbortSignal, markStarted: () => void) => Promise<RunApiModelResponse>
): Promise<RunApiModelResponse> {
  const key = { runId: session.runId, operationId: operation.id };
  const begun = await store.begin({ ...key, requestHash: operation.hash });
  if (begun.state === "done") return restoreResult(begun.response);
  if (begun.state === "conflict") throw new RunApiFailure("operation_conflict", "This operation id was used for a different request.");
  if (begun.state === "pending") throw new RunApiFailure("outcome_unknown", "An earlier model operation has an unknown outcome; it will not be repeated.");
  const stopWatching = session.control.watchCancellation(() => operation.controller.abort(new Error("TASK_CANCELLED")));
  try {
    let response: StoredOperationResponse;
    try {
      operation.controller.signal.throwIfAborted();
      response = { ok: true, result: await create(operation.controller.signal, () => { operation.started = true; }) };
    } catch (error) {
      const reply = errorReply(operation.controller.signal.aborted ? operation.controller.signal.reason : error);
      response = { ok: false, status: reply.status, error: (reply.body as RunApiErrorBody).error };
    }
    await store.finish({ ...key, response });
    return restoreResult(response);
  } finally {
    stopWatching();
  }
}

async function joinOperation(operation: ModelOperation, signal: AbortSignal): Promise<RunApiModelResponse> {
  signal.throwIfAborted();
  clearTimeout(operation.disconnectTimer);
  operation.waiters += 1;
  let onAbort!: () => void;
  try {
    return await Promise.race([
      operation.result,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          if (!operation.started && operation.waiters === 1) operation.controller.abort(signal.reason);
          reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
      })
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    operation.waiters -= 1;
    if (!operation.settled && operation.waiters === 0) {
      operation.disconnectTimer = setTimeout(() => operation.controller.abort(new Error("RUN_API_CLIENT_DISCONNECTED")), RECONNECT_GRACE_MS);
      operation.disconnectTimer.unref();
    }
  }
}

// The durable operation record prevents a replay even after a worker session is replaced.
// While this worker still owns the request, retries wait for its original result.
export async function withModelOperation(
  session: RunApiSession, request: RunApiModelRequest, store: RunOperationStore, signal: AbortSignal,
  create: (signal: AbortSignal, markStarted: () => void) => Promise<RunApiModelResponse>
): Promise<RunApiModelResponse> {
  signal.throwIfAborted();
  const { operationId, ...body } = request;
  const hash = createHash("sha256").update(JSON.stringify(canonicalizeModelPayload({ method: "model/responses", body }))).digest("hex");
  const previous = operations.get(session);
  if (previous?.id === operationId) {
    if (previous.hash !== hash) throw new RunApiFailure("operation_conflict", "This operation id was used for a different request.");
    return joinOperation(previous, signal);
  }
  if (session.modelRequestInFlight) throw new RunApiFailure("rate_limited", "Another model request for this run is in flight. Retry shortly.");
  const operation: ModelOperation = {
    id: operationId, hash, controller: new AbortController(), waiters: 0, settled: false, started: false,
    result: Promise.resolve().then(() => runOnce(session, operation, store, create)).finally(() => {
      operation.settled = true;
      clearTimeout(operation.disconnectTimer);
      session.modelRequestInFlight = false;
    })
  };
  operations.set(session, operation);
  session.modelRequestInFlight = true;
  return joinOperation(operation, signal);
}

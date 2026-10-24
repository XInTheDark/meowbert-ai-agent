import { createHash } from "node:crypto";
import type { RunApiCallRequest, RunApiErrorBody, RunApiMethod } from "@meowbert/shared";
import type { AppendRunMessageInput } from "@meowbert/run-executor/agent/ports/run-control";
import { RUN_API_CALL_HANDLERS } from "./call-handlers.js";
import { RunApiFailure } from "./failure.js";
import { errorReply, storedReply, type RunApiReply } from "./replies.js";
import type { RunApiSession } from "./sessions.js";
import type { RunApiStores, StoredOperationResponse } from "./stores.js";

function hashRequest(method: string, request: RunApiCallRequest): string {
  const { operationId: _operationId, ...rest } = request;
  return createHash("sha256").update(JSON.stringify({ method, rest })).digest("hex");
}

// Writes check the epoch in the database too: another worker may have claimed the run since.
export async function assertCurrentEpoch(stores: RunApiStores, session: RunApiSession): Promise<void> {
  if (await stores.leases.currentEpoch(session.runId) !== session.epoch) {
    throw new RunApiFailure("lease_lost", "This run was claimed again.");
  }
}

// An append must continue the run's branch: onto its last message, or onto messages the control
// plane added after it. Anything else would fork the conversation.
async function assertExtendsBranch(stores: RunApiStores, session: RunApiSession, request: RunApiCallRequest): Promise<void> {
  const expected = request.expectedLeafId ?? (request.args[0] as AppendRunMessageInput | undefined)?.parentMessageId ?? null;
  if (expected === session.leafMessageId) return;
  if (expected !== null && await stores.messages.isAncestor({ taskId: session.taskId, ancestorId: session.leafMessageId, messageId: expected })) return;
  throw new RunApiFailure("leaf_moved", "The conversation moved on since this message was written.", session.leafMessageId);
}

async function applyWrite(stores: RunApiStores, session: RunApiSession, method: RunApiMethod, request: RunApiCallRequest): Promise<unknown> {
  if (method === "control.releaseForStorage") {
    if (!session.holder.startsWith("device:")) throw new RunApiFailure("invalid_request", "Only a device claim can wait for storage.");
    if (!await stores.leases.releaseForStorage({ runId: session.runId, epoch: session.epoch })) {
      throw new RunApiFailure("lease_lost", "This storage-wait claim has ended.");
    }
    session.finishedAt = Date.now();
    session.storageWait = true;
    return { pending: true };
  }
  if (method === "control.appendMessage") await assertExtendsBranch(stores, session, request);
  if (method === "control.emitEvent" && typeof request.seq === "number") {
    // A late duplicate of an event already published is dropped, so events stay in order.
    if (request.seq <= session.lastEventSeq) return null;
    session.lastEventSeq = request.seq;
  }
  const result = await RUN_API_CALL_HANDLERS[method as Exclude<RunApiMethod, "control.heartbeat" | "control.releaseForStorage">](session, request.args);
  if (method === "control.appendMessage") session.leafMessageId = result as string;
  if (method === "control.selectBranch") session.leafMessageId = request.args[0] as string;
  if (method === "control.complete" || method === "control.fail") {
    session.finishedAt = Date.now();
    await stores.leases.release({ runId: session.runId, epoch: session.epoch });
  }
  return result;
}

// A write runs at most once per operation id: a retry gets the first attempt's response, or
// "outcome unknown" when that attempt never finished.
export async function applyDedupedWrite(
  stores: RunApiStores,
  session: RunApiSession,
  method: RunApiMethod,
  request: RunApiCallRequest
): Promise<RunApiReply> {
  if (session.finishedAt === null) await assertCurrentEpoch(stores, session);
  const begun = await stores.operations.begin({ runId: session.runId, operationId: request.operationId, requestHash: hashRequest(method, request) });
  if (begun.state === "done") return storedReply(begun.response);
  if (begun.state === "conflict") throw new RunApiFailure("operation_conflict", "This operation id was used for a different request.");
  if (begun.state === "pending") throw new RunApiFailure("outcome_unknown", "An earlier attempt of this call never finished; its outcome is unknown.");
  let response: StoredOperationResponse;
  try {
    response = { ok: true, result: (await applyWrite(stores, session, method, request)) ?? null };
  } catch (error) {
    const reply = errorReply(error);
    response = { ok: false, status: reply.status, error: (reply.body as RunApiErrorBody).error };
  }
  await stores.operations.finish({ runId: session.runId, operationId: request.operationId, response });
  return storedReply(response);
}

import {
  RUN_LEASE_TTL_MS,
  normalizeWorkspaceFileHost, workspaceFileFeatures,
  isRunApiMethod,
  isRunApiWriteMethod,
  type RunApiCallRequest,
  type RunApiMethod,
  type RunApiModelRequest
} from "@meowbert/shared";
import { verifyRunLeaseToken, type RunLeaseClaims } from "@meowbert/shared/run-lease-token";
import { RUN_API_CALL_HANDLERS } from "./call-handlers.js";
import { RunApiFailure } from "./failure.js";
import { proxyModelRequest, type ModelProxyDeps } from "./model-proxy.js";
import { errorReply, type RunApiReply } from "./replies.js";
import type { RunApiSession, RunApiSessions } from "./sessions.js";
import type { RunApiStores } from "./stores.js";
import { applyDedupedWrite, assertCurrentEpoch } from "./write-path.js";

export type { RunApiReply } from "./replies.js";

export interface RunApiHandlerDeps {
  stores: RunApiStores;
  sessions: RunApiSessions;
  leaseSecret: string;
  model: Omit<ModelProxyDeps, "reservations">;
}

function readBearer(authorization: string | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!match) throw new RunApiFailure("unauthorized", "Missing run lease token.");
  return match[1];
}

function readCallRequest(method: string, body: unknown): RunApiCallRequest {
  if (!isRunApiMethod(method)) throw new RunApiFailure("invalid_request", `Unknown method ${method}.`);
  const request = body as RunApiCallRequest | null;
  if (!request || typeof request.operationId !== "string" || !Array.isArray(request.args)) {
    throw new RunApiFailure("invalid_request", "A call needs an operationId and args.");
  }
  return request;
}

// Answers Run API requests for the runs whose sessions this worker holds.
export function createRunApiHandler(deps: RunApiHandlerDeps) {
  const { stores, sessions } = deps;

  function authorize(runId: string, authorization: string | undefined): RunApiSession {
    let claims: RunLeaseClaims;
    try {
      claims = verifyRunLeaseToken(readBearer(authorization), deps.leaseSecret);
    } catch (error) {
      if (error instanceof RunApiFailure) throw error;
      throw new RunApiFailure("unauthorized", "Invalid run lease token.");
    }
    if (claims.runId !== runId) throw new RunApiFailure("unauthorized", "The token is for another run.");
    const session = sessions.get(runId);
    if (!session || session.epoch !== claims.epoch) throw new RunApiFailure("lease_lost", "This run's lease is no longer held here.");
    return session;
  }

  async function heartbeat(session: RunApiSession): Promise<unknown> {
    if (session.finishedAt !== null) return { ok: true };
    if (!(await stores.leases.renew({ runId: session.runId, epoch: session.epoch, ttlMs: RUN_LEASE_TTL_MS }))) {
      sessions.remove(session.runId);
      throw new RunApiFailure("lease_lost", "This run's lease has ended.");
    }
    return { ok: true };
  }

  return {
    async call(input: { runId: string; method: string; authorization?: string; body: unknown }): Promise<RunApiReply> {
      try {
        const session = authorize(input.runId, input.authorization);
        const request = readCallRequest(input.method, input.body);
        const method = input.method as RunApiMethod;
        if (session.storageWait && method !== "control.releaseForStorage") throw new RunApiFailure("lease_lost", "This device released its claim to wait for storage.");
        await assertCurrentEpoch(stores, session);
        if (session.holder.startsWith("device:") && [
          "platform.createSubtask", "platform.startSubtasks",
          "platform.requestDesktopComputerAction", "platform.getDesktopComputerPresence", "platform.persistentShell"
        ].includes(method)) throw new RunApiFailure("invalid_request", "This feature is unavailable for local runs.");
        const features = workspaceFileFeatures(normalizeWorkspaceFileHost(session.fileHost));
        if ((!features.memorySearch && method === "platform.searchMemory")
          || (!features.canvases && ["platform.createProjectCanvas", "platform.recordProjectCanvasEntry"].includes(method))
          || (!features.linkedSources && ["platform.liveSyncStatus", "platform.liveSyncTransfer"].includes(method))) {
          throw new RunApiFailure("invalid_request", "This feature is unavailable for device-hosted workspaces.");
        }
        if (method === "control.heartbeat") return { status: 200, body: { result: await heartbeat(session) } };
        if (isRunApiWriteMethod(method)) return await applyDedupedWrite(stores, session, method, request);
        if (session.finishedAt !== null) throw new RunApiFailure("lease_lost", "This run has ended.");
        return { status: 200, body: { result: (await RUN_API_CALL_HANDLERS[method as keyof typeof RUN_API_CALL_HANDLERS](session, request.args)) ?? null } };
      } catch (error) {
        return errorReply(error);
      }
    },
    async model(input: { runId: string; authorization?: string; body: unknown; signal: AbortSignal }): Promise<RunApiReply> {
      try {
        const session = authorize(input.runId, input.authorization);
        await assertCurrentEpoch(stores, session);
        if (session.finishedAt !== null) throw new RunApiFailure("lease_lost", "This run has ended.");
        if (session.storageWait) throw new RunApiFailure("lease_lost", "This device released its claim to wait for storage.");
        const result = await proxyModelRequest(session, input.body as RunApiModelRequest, { ...deps.model, reservations: stores.reservations }, input.signal);
        return { status: 200, body: result };
      } catch (error) {
        return errorReply(error);
      }
    }
  };
}

export type RunApiHandler = ReturnType<typeof createRunApiHandler>;

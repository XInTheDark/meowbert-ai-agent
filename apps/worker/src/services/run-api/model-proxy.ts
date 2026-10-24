import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { ModelUsageCounts, RunApiModelRequest, RunApiModelResponse } from "@meowbert/shared";
import { canonicalizeModelPayload } from "@meowbert/run-executor/agent/model";
import { estimateContextTokens } from "@meowbert/run-executor/context-compaction/token-estimation";
import type { RunApiSession, RunModelPolicy } from "./sessions.js";
import type { UsageReservationStore } from "./stores.js";
import { RunApiFailure } from "./failure.js";

const PURPOSES = new Set<RunApiModelRequest["purpose"]>(["turn", "compaction", "title", "web_search"]);

// Fields the executor builds itself. Anything else must be one of the route's own fields, sent
// unchanged; the server always sets the model.
const CLIENT_FIELDS = new Set([
  "input",
  "instructions",
  "include",
  "store",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "prompt_cache_key",
  "prompt_cache_options",
  "user",
  "max_output_tokens"
]);

const CLIENT_HEADERS = new Set(["x-session-affinity", "x-meridian-cache-keepalive", "x-meridian-agent"]);
const CLIENT_TOOL_TYPES = new Set(["function", "custom"]);

function sameValue(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown) => JSON.stringify(canonicalizeModelPayload({ value }));
  return canonical(left) === canonical(right);
}

function reject(message: string): never {
  throw new RunApiFailure("invalid_request", message);
}

function validateTools(tools: unknown, request: RunApiModelRequest, policy: RunModelPolicy): void {
  if (tools === undefined) return;
  if (!Array.isArray(tools)) reject("tools must be an array.");
  for (const tool of tools) {
    const type = (tool as { type?: unknown } | null)?.type;
    if (typeof type === "string" && CLIENT_TOOL_TYPES.has(type)) continue;
    // Provider-hosted search is billed by the provider, so only runs allowed to search get it.
    if (type === "web_search" && request.purpose === "turn" && policy.allowHostedWebSearch) continue;
    reject(`Tool type ${String(type)} is not allowed.`);
  }
}

export function validateModelRequest(request: RunApiModelRequest, policy: RunModelPolicy): void {
  if (!PURPOSES.has(request.purpose)) reject("Unknown model request purpose.");
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) reject("body must be an object.");
  for (const [key, value] of Object.entries(request.body)) {
    if (CLIENT_FIELDS.has(key)) continue;
    if (key in policy.modelPayload && sameValue(value, policy.modelPayload[key])) continue;
    reject(`Field ${key} is not allowed.`);
  }
  if (request.body.store === true) reject("store must be false.");
  const maxOutputTokens = request.body.max_output_tokens;
  if (maxOutputTokens !== undefined && (typeof maxOutputTokens !== "number" || maxOutputTokens < 1 || maxOutputTokens > policy.maxContextTokens)) {
    reject("max_output_tokens is out of range.");
  }
  validateTools(request.body.tools, request, policy);
  for (const header of Object.keys(request.headers ?? {})) {
    if (!CLIENT_HEADERS.has(header.toLowerCase())) reject(`Header ${header} is not allowed.`);
  }
}

// The most the request could produce: its input, counted here, plus every output token the
// model's context window leaves room for unless the request sets a lower limit.
export function estimateMaximumUsage(request: RunApiModelRequest, policy: RunModelPolicy): ModelUsageCounts {
  const model = policy.model(request.purpose);
  const input = Array.isArray(request.body.input) ? request.body.input as ResponseInputItem[] : [];
  const instructions = typeof request.body.instructions === "string" ? request.body.instructions : "";
  const inputTokens = estimateContextTokens(instructions, input, model);
  const maxOutput = typeof request.body.max_output_tokens === "number"
    ? request.body.max_output_tokens
    : Math.max(1, policy.maxContextTokens - inputTokens);
  return { inputTokens, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: maxOutput, reasoningTokens: 0 };
}

export interface ModelProxyDeps {
  reservations: UsageReservationStore;
  weighUsage(model: string, counts: ModelUsageCounts): Promise<number>;
  // Bills a request the executor walked away from, at its reserved maximum.
  chargeAbandoned(policy: RunModelPolicy, model: string, counts: ModelUsageCounts): Promise<void>;
}

// Forwards one model request for a run: validated against the run's route, held against the
// user's allowance at its maximum cost first, then settled to what the provider reports.
export async function proxyModelRequest(
  session: RunApiSession,
  request: RunApiModelRequest,
  deps: ModelProxyDeps,
  signal: AbortSignal
): Promise<RunApiModelResponse> {
  const policy = session.policy();
  validateModelRequest(request, policy);
  if (session.modelRequestInFlight) throw new RunApiFailure("invalid_request", "Another model request for this run is in flight.");
  session.modelRequestInFlight = true;
  let reservationId: string | null = null;
  const model = policy.model(request.purpose);
  const maximum = estimateMaximumUsage(request, policy);
  try {
    if (policy.billing && !policy.quotaExempt) {
      const reservation = await deps.reservations.reserve({
        userId: policy.billing.userId,
        runId: session.runId,
        weightedTokens: await deps.weighUsage(model, maximum)
      });
      if (!reservation) throw new RunApiFailure("quota_exceeded", "Subscription usage limit reached.");
      reservationId = reservation.id;
    }
    try {
      return await session.models.create({
        purpose: request.purpose,
        body: request.body,
        ...(request.headers ? { headers: request.headers } : {}),
        timeoutMs: request.timeoutMs,
        signal,
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        ...(request.attempt ? { attempt: request.attempt } : {})
      });
    } catch (error) {
      if (signal.aborted && policy.billing) await deps.chargeAbandoned(policy, model, maximum);
      throw error;
    }
  } finally {
    if (reservationId) await deps.reservations.release(reservationId);
    session.modelRequestInFlight = false;
  }
}

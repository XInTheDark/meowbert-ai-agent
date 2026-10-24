import type { Response } from "openai/resources/responses/responses";
import { parseModelResponseUsage, streamResponseToFinal } from "@meowbert/shared";
import { getOpenAiClient, type OpenAiProviderConfig } from "@meowbert/run-executor/agent/openai-client";
import { buildChatGptCodexProvider } from "@meowbert/run-executor/agent/chatgpt-request";
import { withOpenAiRequestDebugLogging } from "../agent/openai-sdk-logger.js";
import { extractNetworkRequestErrorResponse } from "../agent/model-error-response-log.js";
import {
  emitNetworkRequestEvent,
  type NetworkRequestLogCallback,
  type NetworkRequestReplayPayload
} from "../agent/network-request-log.js";
import { platformUsageRecorder } from "../tasks/platform-usage.js";
import { getUserMonthlySubscriptionQuotaStatus } from "../tasks/subscription-usage.js";
import type { ModelCallPurpose, ModelGateway, ModelGatewayRequest } from "@meowbert/run-executor/agent/ports/model-gateway";
import type { ServerRunState } from "./bootstrap.js";

const PURPOSE_ENDPOINTS: Record<ModelCallPurpose, string> = {
  turn: "responses.create",
  compaction: "responses.create.compaction",
  title: "responses.create.title",
  web_search: "responses.create.web_search"
};

interface DirectModelGatewayOptions {
  requireRun: () => ServerRunState;
  // Set when the run logs its model requests.
  onNetworkRequest?: NetworkRequestLogCallback;
  // Reports a failure to bill an agent turn where the task's user can see it.
  reportTurnUsageError: (message: string) => Promise<void>;
}

function shellEscapeSingleQuoted(value: string): string {
  return value.replace(/'/g, `'\"'\"'`);
}

function buildCurlCommand(input: { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> }): string {
  const lines = [`curl \\\n  '${shellEscapeSingleQuoted(input.url)}' \\`];
  lines.splice(1, 0, `  -X ${input.method} \\`);
  for (const [key, value] of Object.entries(input.headers)) {
    lines.push(`  -H '${shellEscapeSingleQuoted(`${key}: ${value}`)}' \\`);
  }
  lines.push(`  --data-binary '${shellEscapeSingleQuoted(JSON.stringify(input.body, null, 2))}'`);
  return lines.join("\n");
}

// A copy of the request someone can replay by hand, with the key left out.
export function buildReplayPayload(input: {
  provider: OpenAiProviderConfig;
  requestBody: Record<string, unknown>;
  requestHeaders?: Record<string, string>;
}): NetworkRequestReplayPayload {
  const method = "POST";
  const url = `${input.provider.baseUrl.replace(/\/+$/, "")}/responses`;
  const headers = {
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: input.provider.apiKey.trim().length > 0 ? "Bearer <REPLACE_WITH_API_KEY>" : "Bearer <ADD_API_KEY>",
    ...(input.provider.defaultHeaders ?? {}),
    ...(input.requestHeaders ?? {})
  };
  const body = { ...input.requestBody, stream: true };
  return { method, url, headers, body, curl: buildCurlCommand({ method, url, headers, body }) };
}

function attachResponseStreamEvents(target: object, events: unknown[]): void {
  Object.defineProperty(target, "__meowbertResponseStreamEvents", {
    value: events,
    enumerable: false,
    configurable: true
  });
}

function readResponseStreamEvents(target: unknown): unknown[] {
  return target instanceof Error || (typeof target === "object" && target !== null)
    ? ((target as { __meowbertResponseStreamEvents?: unknown[] }).__meowbertResponseStreamEvents ?? [])
    : [];
}

export function resolvePurposeModel(run: ServerRunState, purpose: ModelCallPurpose): string {
  return purpose === "title" ? run.bootstrap.runtime.quickModel : run.bootstrap.runtime.model;
}

async function streamProviderResponse(input: {
  provider: OpenAiProviderConfig;
  model: string;
  body: Record<string, unknown>;
  request: ModelGatewayRequest;
  onNetworkRequest?: NetworkRequestLogCallback;
  attempt: number;
}): Promise<Response> {
  const endpoint = PURPOSE_ENDPOINTS[input.request.purpose];
  const baseClient = getOpenAiClient(input.provider);
  const client = input.onNetworkRequest
    ? withOpenAiRequestDebugLogging(baseClient, {
        endpoint,
        model: input.model,
        baseUrl: input.provider.baseUrl,
        attempt: input.attempt,
        onNetworkRequest: input.onNetworkRequest
      })
    : baseClient;
  const events: unknown[] | undefined = input.onNetworkRequest ? [] : undefined;
  const response = await streamResponseToFinal(client, input.body, {
    maxRetries: 0,
    timeout: input.request.timeoutMs,
    ...(input.request.headers && Object.keys(input.request.headers).length > 0 ? { headers: input.request.headers } : {}),
    ...(input.request.signal ? { signal: input.request.signal } : {})
  }, {
    onEvent: (event) => {
      events?.push(event);
      input.request.onEvent?.(event);
    }
  }).catch((error: unknown) => {
    if (events && error instanceof Error) attachResponseStreamEvents(error, events);
    throw error;
  });
  if (events) attachResponseStreamEvents(response as object, events);
  return response;
}

async function logged<T>(input: {
  onNetworkRequest?: NetworkRequestLogCallback;
  provider: OpenAiProviderConfig;
  model: string;
  body: Record<string, unknown>;
  request: ModelGatewayRequest;
  attempt: number;
  call: () => Promise<T>;
}): Promise<T> {
  const base = {
    service: "openai_responses" as const,
    endpoint: PURPOSE_ENDPOINTS[input.request.purpose],
    model: input.model,
    baseUrl: input.provider.baseUrl,
    attempt: input.attempt
  };
  const startedAt = Date.now();
  await emitNetworkRequestEvent(input.onNetworkRequest, {
    ...base,
    phase: "start",
    request: buildReplayPayload({ provider: input.provider, requestBody: input.body, requestHeaders: input.request.headers })
  });
  try {
    const result = await input.call();
    await emitNetworkRequestEvent(input.onNetworkRequest, {
      ...base,
      phase: "success",
      durationMs: Date.now() - startedAt,
      responseStream: { events: readResponseStreamEvents(result) }
    });
    return result;
  } catch (error) {
    const errorResponse = extractNetworkRequestErrorResponse(error);
    await emitNetworkRequestEvent(input.onNetworkRequest, {
      ...base,
      phase: "error",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      ...(errorResponse ? { errorResponse } : {}),
      responseStream: { events: readResponseStreamEvents(error) }
    });
    throw error;
  }
}

// Bills the response to the run and returns its weighted cost.
async function settleUsage(
  run: ServerRunState,
  purpose: ModelCallPurpose,
  model: string,
  response: Response,
  reportTurnUsageError: (message: string) => Promise<void>
): Promise<number | null> {
  const counts = parseModelResponseUsage(response.usage);
  if (!counts) return null;
  try {
    const cost = await platformUsageRecorder.computeCost(model, counts);
    if (run.billing) await platformUsageRecorder.recordEvent(run.billing, counts, cost);
    return cost.weightedTokens;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (purpose === "turn") {
      await reportTurnUsageError(`Failed to record token usage event: ${message}`);
    } else {
      console.error("[platform-usage] Failed to record model usage", { taskId: run.job.taskId, model, error: message });
    }
    return null;
  }
}

// Model calls straight to the run's provider, from inside the control plane.
export function createDirectModelGateway(options: DirectModelGatewayOptions): ModelGateway {
  return {
    async create(request) {
      const run = options.requireRun();
      const model = resolvePurposeModel(run, request.purpose);
      const provider = buildChatGptCodexProvider(run.provider, request.sessionId);
      const body = { ...request.body, model };
      const attempt = request.attempt ?? 1;
      const response = await logged({
        onNetworkRequest: options.onNetworkRequest,
        provider,
        model,
        body,
        request,
        attempt,
        call: () => streamProviderResponse({ provider, model, body, request, onNetworkRequest: options.onNetworkRequest, attempt })
      });
      return { response, weightedTokens: await settleUsage(run, request.purpose, model, response, options.reportTurnUsageError) };
    },
    async isQuotaExceeded() {
      const run = options.requireRun();
      if (!run.billing || run.quotaExempt) return false;
      const quota = await getUserMonthlySubscriptionQuotaStatus(run.billing.userId);
      return quota.limit > 0 && quota.exceeded;
    }
  };
}

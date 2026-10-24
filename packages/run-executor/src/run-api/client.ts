import { randomUUID } from "node:crypto";
import {
  type RunApiCallRequest,
  type RunApiErrorBody,
  type RunApiErrorCode,
  type RunApiMethod,
  type RunApiModelRequest,
  type RunApiModelResponse
} from "@meowbert/shared";

export class RunApiError extends Error {
  constructor(
    readonly code: RunApiErrorCode,
    message: string,
    readonly status: number,
    readonly currentLeafId: string | null = null
  ) {
    super(message);
    this.name = "RunApiError";
  }
}

export interface RunApiClientOptions {
  // The control plane's base URL; routes live under `/runs/:runId`.
  baseUrl: string;
  runId: string;
  token: string;
  fetch?: typeof fetch;
  // Waits between attempts of a call whose response never arrived.
  retryDelaysMs?: number[];
}

export interface RunApiClient {
  call(method: RunApiMethod, args: unknown[], extra?: Pick<RunApiCallRequest, "expectedLeafId" | "seq">): Promise<unknown>;
  // Never retried: a model request that may have reached the provider is not sent twice.
  model(request: Omit<RunApiModelRequest, "operationId">, signal?: AbortSignal): Promise<RunApiModelResponse>;
}

const DEFAULT_RETRY_DELAYS_MS = [250, 1_000, 3_000, 6_000];

function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function readError(response: Response): Promise<RunApiError> {
  const body = await response.json().catch(() => null) as RunApiErrorBody | null;
  return new RunApiError(
    body?.error.code ?? (response.status === 401 ? "unauthorized" : "internal"),
    body?.error.message ?? `Run API request failed with status ${response.status}.`,
    response.status,
    body?.error.currentLeafId ?? null
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRunApiClient(options: RunApiClientOptions): RunApiClient {
  const fetchImpl = options.fetch ?? fetch;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const runUrl = `${options.baseUrl.replace(/\/+$/, "")}/runs/${encodeURIComponent(options.runId)}`;
  const headers = { "content-type": "application/json", authorization: `Bearer ${options.token}` };

  async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    return fetchImpl(`${runUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
  }

  return {
    // Every attempt of one call carries the same operation id, so the server applies a write once
    // however many times its response is lost.
    async call(method, args, extra = {}) {
      const request: RunApiCallRequest = { operationId: randomUUID(), args, ...extra };
      // Reads are retried freely; writes are safe to retry because of the operation id.
      const attempts = retryDelaysMs.length + 1;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) await sleep(retryDelaysMs[attempt - 1]);
        let response: Response;
        try {
          response = await post(`/call/${method}`, request);
        } catch (error) {
          lastError = error;
          continue;
        }
        if (response.ok) {
          return ((await response.json()) as { result: unknown }).result;
        }
        if (isRetryableStatus(response.status)) {
          lastError = await readError(response);
          continue;
        }
        throw await readError(response);
      }
      throw lastError instanceof Error ? lastError : new Error(`Run API call ${method} failed.`);
    },
    async model(request, signal) {
      const response = await post("/model/responses", { ...request, operationId: randomUUID() }, signal);
      if (!response.ok) throw await readError(response);
      return (await response.json()) as RunApiModelResponse;
    }
  };
}

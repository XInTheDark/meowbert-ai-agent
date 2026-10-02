import OpenAI from "openai";
import { streamResponseToFinal } from "@meowbert/shared";
import { getAbortError, throwIfAborted } from "./abort-signal.js";
import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem
} from "openai/resources/responses/responses";

interface ToolObjectExtractionInput {
  client: OpenAI;
  model: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  input: ResponseInputItem[];
  modelPayload?: Record<string, unknown>;
  requestTimeoutMs?: number;
  abortSignal?: AbortSignal;
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  onRetry?: (context: ToolObjectExtractionRetryContext) => Promise<void> | void;
  // Called with the usage of every completed response, including attempts that are retried.
  onResponseUsage?: (usage: unknown) => Promise<void> | void;
}

export type ToolObjectExtractionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface ToolObjectExtractionRetryContext {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: Error;
}

const DEFAULT_TOOL_EXTRACTION_MAX_ATTEMPTS = 1;
const DEFAULT_TOOL_EXTRACTION_BASE_DELAY_MS = 5000;

function isFunctionCallItem(item: ResponseOutputItem): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}

function resolveMaxAttempts(maxAttempts: number | undefined): number {
  if (typeof maxAttempts !== "number" || !Number.isFinite(maxAttempts)) {
    return DEFAULT_TOOL_EXTRACTION_MAX_ATTEMPTS;
  }

  const rounded = Math.floor(maxAttempts);
  return rounded > 0 ? rounded : DEFAULT_TOOL_EXTRACTION_MAX_ATTEMPTS;
}

function resolveBaseRetryDelayMs(baseRetryDelayMs: number | undefined): number {
  if (typeof baseRetryDelayMs !== "number" || !Number.isFinite(baseRetryDelayMs)) {
    return DEFAULT_TOOL_EXTRACTION_BASE_DELAY_MS;
  }

  const rounded = Math.floor(baseRetryDelayMs);
  return rounded > 0 ? rounded : 0;
}

async function sleepWithOptionalAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timeout);
      reject(getAbortError(signal) ?? new Error("TASK_CANCELLED"));
    }

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function extractObjectWithToolCall<T>(
  input: ToolObjectExtractionInput
): Promise<ToolObjectExtractionResult<T>> {
  const tool: FunctionTool = {
    type: "function",
    name: input.toolName,
    description: input.toolDescription,
    strict: true,
    parameters: input.schema
  };
  const maxAttempts = resolveMaxAttempts(input.maxAttempts);
  const baseRetryDelayMs = resolveBaseRetryDelayMs(input.baseRetryDelayMs);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfAborted(input.abortSignal);

    try {
      const response = await streamResponseToFinal(input.client, {
        ...(input.modelPayload ?? {}),
        model: input.model,
        input: input.input,
        tools: [tool],
        tool_choice: {
          type: "function",
          name: input.toolName
        },
        parallel_tool_calls: false,
        store: false
      }, {
        maxRetries: 0,
        ...(typeof input.requestTimeoutMs === "number" ? { timeout: input.requestTimeoutMs } : {}),
        ...(input.abortSignal ? { signal: input.abortSignal } : {})
      });
      await input.onResponseUsage?.(response.usage);

      if (response.error) {
        throw new Error(response.error.message);
      }

      const toolCall = response.output.find(
        (item) => isFunctionCallItem(item) && item.name === input.toolName
      ) as ResponseFunctionToolCall | undefined;
      if (!toolCall) {
        throw new Error("Model did not return the expected tool call output");
      }

      try {
        const parsed = JSON.parse(toolCall.arguments) as T;
        return { ok: true, value: parsed };
      } catch {
        throw new Error("Model returned invalid JSON tool arguments");
      }
    } catch (error) {
      if (
        (error instanceof Error && (error.message === "TASK_CANCELLED" || error.message === "RUN_TIME_LIMIT_REACHED"))
      ) {
        throw error;
      }

      const abortError = getAbortError(input.abortSignal);
      if (abortError) {
        throw abortError;
      }

      lastError = toError(error);
      const hasRetryRemaining = attempt < maxAttempts - 1;
      if (!hasRetryRemaining) {
        break;
      }

      const delayMs = baseRetryDelayMs * Math.pow(2, attempt);
      if (input.onRetry) {
        await input.onRetry({
          attempt: attempt + 1,
          maxAttempts,
          delayMs,
          error: lastError
        });
      }
      await sleepWithOptionalAbort(delayMs, input.abortSignal);
    }
  }

  return { ok: false, error: lastError?.message ?? "Tool-call extraction failed." };
}

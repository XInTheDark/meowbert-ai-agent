import OpenAI from "openai";
import type { AiProviderConfig } from "@meowbert/shared";
import { getOpenAiClient } from "../agent/openai-client.js";

export async function sendActivationRequest(provider: AiProviderConfig, model: string): Promise<void> {
  const client = getOpenAiClient(provider);
  const stream = await client.responses.create({
    model, input: "Reply with OK.", max_output_tokens: 128, store: false, stream: true
  }, { signal: AbortSignal.timeout(30_000), timeout: 30_000, maxRetries: 0 });
  let receivedResult = false;
  for await (const event of stream) {
    if (event.type === "error" || event.type === "response.failed") throw new Error("provider_failure");
    if (event.type === "response.completed") receivedResult = true;
    if (event.type === "response.incomplete") {
      if (event.response.incomplete_details?.reason !== "max_output_tokens") throw new Error("provider_failure");
      receivedResult = true;
    }
  }
  if (!receivedResult) throw new Error("missing_result");
}

/** Provider error bodies can echo credentials and request data; persist only safe summaries. */
export function activationErrorMessage(error: unknown): string {
  if (error instanceof OpenAI.APIError && error.status) return `Provider returned HTTP ${error.status}.`;
  if (error instanceof Error && error.message === "provider_missing") return "Provider was removed. Choose another provider.";
  if (error instanceof OpenAI.APIConnectionTimeoutError || (error instanceof Error && /timeout|abort/i.test(error.name))) {
    return "Provider request timed out after 30 seconds.";
  }
  return "Provider request failed or ended without a result. Check the provider and model.";
}

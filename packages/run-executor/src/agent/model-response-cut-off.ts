import type { Response, ResponseOutputItem } from "openai/resources/responses/responses";

// A response cut off mid tool call (dropped stream, proxy timeout) is retried this many times
// before it is accepted, so a repeat cut-off reaches the model as a tool error instead of failing the run.
export const MODEL_RESPONSE_CUT_OFF_RETRIES = 1;

export const CUT_OFF_TOOL_CALL_ERROR =
  "Your response was cut off before this tool call finished, so it did not run. Send large content in smaller pieces.";

export class ModelResponseCutOffError extends Error {
  constructor() {
    super("Model response was cut off in the middle of a tool call.");
    this.name = "ModelResponseCutOffError";
  }
}

export function isCutOffFunctionCall(item: ResponseOutputItem): boolean {
  return item.type === "function_call" && item.status === "incomplete";
}

// Hitting max_output_tokens truncates the same way on every retry, so only other cut-offs are retried.
export function isRetryableCutOffResponse(response: Response): boolean {
  return response.incomplete_details?.reason !== "max_output_tokens"
    && response.output.some(isCutOffFunctionCall);
}

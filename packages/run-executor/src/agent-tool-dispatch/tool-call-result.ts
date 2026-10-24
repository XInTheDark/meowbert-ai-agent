import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { ToolDispatchResult } from "./types.js";

type RunRequests = Pick<ToolDispatchResult, "finalResponse" | "waitRequest" | "stopRequest" | "workflowPause">;

// What a tool handler hands back. Handlers never write to the conversation: dispatch records the
// result for a call the model made, and exec passes it to the script for a call made inside one.
export type ToolCallResult = {
  output: unknown;
  // Messages the model sees right after the output, such as a loaded image or PDF.
  shownItems?: ResponseInputItem[];
} & {
  // Requests that change how the run continues once this turn's calls are done.
  [Request in keyof RunRequests]?: NonNullable<RunRequests[Request]>;
};

export function toolErrorResult(error: string): ToolCallResult {
  return { output: { error } };
}

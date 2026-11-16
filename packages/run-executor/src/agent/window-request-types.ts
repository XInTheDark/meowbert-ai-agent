import type { FunctionTool, Tool } from "openai/resources/responses/responses";
import type { PromptEnvelope } from "./prompt-envelope.js";
import type { ModelToolChoice } from "./model.js";

// The immutable effective setup and the last ordinary request's tools, kept per context window.
export interface WindowRequestState {
  envelope: Pick<PromptEnvelope, "baseVersion" | "baseFrames" | "deltas">;
  tools: { response: Tool[]; codeMode: FunctionTool[] };
  toolChoice?: ModelToolChoice;
}

// What a request may change in the saved recipe: nothing (idle compaction replays the last turn),
// only the tool choice, or the tool definitions too.
export type WindowRequestUpdate = "replay" | "tool_choice" | "tools";

import type { FunctionTool, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import type { PromptEnvelope, PromptEnvelopeDelta, PromptEnvelopeFrame } from "../agent/prompt-envelope.js";
import type { TaskMessageToolOptions } from "../agent/types.js";
import type { SubagentRuntime } from "../subagents/types.js";
import type { ContextManagementV2State } from "../context-management-v2/types.js";

// A fork is a snapshot of the parent's exact request, so a lane's first request matches the parent's
// last one byte for byte up to the lane's own tool result and reads the parent's cached prefix.

export interface ForkSeedEnvelope {
  baseVersion: string;
  baseFrames: PromptEnvelopeFrame[];
  deltas: PromptEnvelopeDelta[];
}

export interface ForkSeedTools {
  response: Tool[];
  // Tools reachable only through exec when the parent ran in code mode.
  codeMode: FunctionTool[];
}

// What the seed's tools depend on at run time, so their handlers work in the lane.
export interface ForkSeedCapabilities {
  runtime: SubagentRuntime;
  runToolOptions: TaskMessageToolOptions;
  loadedToolGroups: string[];
  spinePath: string | null;
}

export interface ForkSeed {
  id: string;
  envelope: ForkSeedEnvelope;
  tools: ForkSeedTools;
  items: ResponseInputItem[];
  capabilities: ForkSeedCapabilities;
}

// The turn that produced the split call, as the agent loop sent it.
export interface SwarmTurnSnapshot {
  envelope: PromptEnvelope;
  responseTools: Tool[];
  codeModeTools: FunctionTool[];
}

// Queued conversation deltas are already in the conversation items, so only the prefix is kept.
export function snapshotForkEnvelope(envelope: PromptEnvelope): ForkSeedEnvelope {
  return structuredClone({ baseVersion: envelope.baseVersion, baseFrames: envelope.baseFrames, deltas: envelope.deltas });
}

// The lane's envelope is sealed from the start: anything added during its runs is appended to the
// end of its conversation, never to the inherited prefix.
export function restoreForkEnvelope(seed: ForkSeedEnvelope): PromptEnvelope {
  return { ...structuredClone(seed), sealed: true, conversationDeltas: [], drainedConversationDeltaCount: 0 };
}

// What a forked lane's run starts from: the seed's prefix, and its window as stored.
export interface LaneRunSetup {
  seed: ForkSeed;
  promptEnvelope: PromptEnvelope;
  contextManagement: ContextManagementV2State;
  conversationItems: ResponseInputItem[];
}

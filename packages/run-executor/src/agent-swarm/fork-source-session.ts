import { buildPromptCacheKey } from "../agent/turn-request.js";
import type { ForkSeed } from "./fork-types.js";
import type { SwarmRunContext } from "./run-context.js";

// A forked lane on its parent's model names the parent's session, so a session-resuming proxy
// (Meridian) can start the lane from the parent's transcript instead of replaying the history.
// The parent's session key is built the same way from the shared prefix. Lanes on another model,
// or whose seed was compacted, gain nothing from it, and the proxy replays as before.
export function laneForkSourceSessionKey(input: {
  swarm: Pick<SwarmRunContext, "lane"> | null;
  laneSeed: Pick<ForkSeed, "capabilities"> | null;
  runtimeModel: string;
  promptPrefixHash: string;
}): string | undefined {
  const parentTaskId = input.swarm?.lane?.parent_task_id;
  if (!parentTaskId || !input.laneSeed || input.laneSeed.capabilities.runtime.model !== input.runtimeModel) return undefined;
  return buildPromptCacheKey(parentTaskId, input.promptPrefixHash);
}

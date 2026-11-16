import type { TaskToolOptions } from "../lib/types";
import type { TaskMessageSetup } from "./taskMessageSetup";

// Changes to a follow-up that make the task's next request re-read its whole conversation without the
// prompt cache. Other tool changes reach the agent as a note and keep the cache.
export type CacheBreakingChange = "agent" | "computer_use";

export interface FollowUpSetup {
  toolOptions: TaskToolOptions;
  agentId: string | null;
}

export function findCacheBreakingChanges(previous: TaskMessageSetup | null, next: FollowUpSetup): CacheBreakingChange[] {
  if (!previous) return [];
  const changes: CacheBreakingChange[] = [];
  // A message without an agent ran on the default one, which the composer also shows as selected.
  if (previous.agentId !== null && next.agentId !== null && previous.agentId !== next.agentId) changes.push("agent");
  // Computer use adds tools the agent calls directly, so they must join its tool definitions.
  if (next.toolOptions.computerUse && !previous.toolOptions.computerUse) changes.push("computer_use");
  return changes;
}

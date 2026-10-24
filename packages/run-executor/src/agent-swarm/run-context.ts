import type { AgentSwarmSettings, PlatformModelRouter } from "@meowbert/shared";
import type { SwarmActivity } from "./activity.js";
import type { SwarmLaneRow } from "./lane-types.js";

// What a run needs to know about the swarm it belongs to. The leader has no lane row.
export interface SwarmRunContext {
  swarmTaskId: string;
  settings: AgentSwarmSettings;
  // The swarm's model router, when its settings name one that exists.
  router: PlatformModelRouter | null;
  lane: SwarmLaneRow | null;
  // Lanes above this one, nearest first; their notes reach this lane.
  ancestorLaneIds: string[];
  // This lane or one above it answers a diverge question, so it cannot diverge again.
  withinDiverge: boolean;
  // Set when the runtime makes the lane submit now (stop, budget, deadline); the reason is shown to it.
  forcedSubmitReason: string | null;
  // The leader was told this run that the budget or time is gone.
  budgetNoteSent: boolean;
  // Files and pages this run touched since its last step, for automatic notes.
  activity: SwarmActivity;
}

export function swarmDepth(context: Pick<SwarmRunContext, "lane">): number {
  return context.lane?.depth ?? 0;
}

import {
  findPlatformModelRouterById,
  normalizeAgentSwarmSettings,
  type AgentSwarmSettings,
  type PlatformModelRouter
} from "@meowbert/shared";
import { pool, query } from "../../lib/db.js";
import type { TaskRow } from "../agent/types.js";
import { createSwarmActivity, type SwarmActivity } from "./auto-notes.js";
import { listAncestorLanes, loadLane, type SwarmLaneRow } from "./lane-store.js";

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

// Loads the resolved config frozen on the swarm row at creation; presets are never re-read.
export async function loadSwarmRunContext(
  task: Pick<TaskRow, "id" | "workflow_type" | "workflow_parent_task_id" | "workflow_internal_role">,
  routers: PlatformModelRouter[] = []
): Promise<SwarmRunContext | null> {
  if (task.workflow_type !== "agent_swarm") return null;
  const swarmTaskId = task.workflow_parent_task_id ?? task.id;
  const swarm = await query<{ config_json: unknown }>("SELECT config_json FROM task_swarms WHERE task_id = $1", [swarmTaskId]);
  if (!swarm.rows[0]) return null;
  const isLane = task.workflow_internal_role === "lane";
  const lane = isLane ? await loadLane(pool, task.id) : null;
  if (isLane && !lane) return null;
  const ancestors = lane ? await listAncestorLanes(pool, lane) : [];
  const settings = normalizeAgentSwarmSettings(swarm.rows[0].config_json);
  return {
    swarmTaskId,
    settings,
    router: findPlatformModelRouterById(routers, settings.routerId),
    lane,
    ancestorLaneIds: ancestors.map((ancestor) => ancestor.task_id),
    withinDiverge: lane?.kind === "diverge" || ancestors.some((ancestor) => ancestor.kind === "diverge"),
    forcedSubmitReason: null,
    budgetNoteSent: false,
    activity: createSwarmActivity()
  };
}

export function swarmDepth(context: Pick<SwarmRunContext, "lane">): number {
  return context.lane?.depth ?? 0;
}

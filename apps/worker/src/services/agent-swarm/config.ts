import {
  findPlatformModelRouterById,
  normalizeAgentSwarmSettings,
  type PlatformModelRouter
} from "@meowbert/shared";
import { pool, query } from "../../lib/db.js";
import type { TaskRow } from "@meowbert/run-executor/agent/types";
import { createSwarmActivity } from "@meowbert/run-executor/agent-swarm/activity";
import { listAncestorLanes, loadLane } from "./lane-store.js";
import type { SwarmRunContext } from "@meowbert/run-executor/agent-swarm/run-context";

export { swarmDepth, type SwarmRunContext } from "@meowbert/run-executor/agent-swarm/run-context";

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

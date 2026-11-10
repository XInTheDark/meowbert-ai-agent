import {
  findPlatformModelRouterById,
  parseChosenModelRoute,
  type ChosenModelRoute,
  type PlatformModelRouter
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { extractModelRequestPayload } from "@meowbert/run-executor/agent/utils";
import { resolveChosenRoute } from "../model-routing/router-resolution.js";
import type { SubagentRuntime } from "@meowbert/run-executor/subagents/types";

export { buildLaneModelRoute, pickCheckModelRoute, routesToOtherModel } from "@meowbert/run-executor/agent-swarm/model-route";

export async function loadLaneModelRoute(laneTaskId: string): Promise<ChosenModelRoute | null> {
  const result = await query<{ model_route_json: unknown }>("SELECT model_route_json FROM task_swarm_lanes WHERE task_id = $1", [laneTaskId]);
  return parseChosenModelRoute(result.rows[0]?.model_route_json);
}

// A picked lane keeps the provider it was forked on and swaps in the target's model and payload.
// Router targets are platform models, so a lane on a bring-your-own provider keeps its own model.
export function applyLaneModelRoute(
  runtime: SubagentRuntime,
  route: ChosenModelRoute | null,
  routers: PlatformModelRouter[],
  environmentPayload: Record<string, unknown>
): SubagentRuntime {
  if (!route || runtime.provider.kind !== "platform") return runtime;
  const router = findPlatformModelRouterById(routers, route.routerId);
  if (!router) return runtime;
  const resolution = resolveChosenRoute(route, router, router.id, environmentPayload);
  return { ...runtime, model: resolution.resolvedModel, payload: extractModelRequestPayload(resolution.resolvedEnvironmentPayload) };
}
